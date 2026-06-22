/*
 * Copyright (c) 2010-2026 Haifeng Li. All rights reserved.
 *
 * SMILE Serve is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * SMILE Serve is distributed in the hope that it will be useful,
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with SMILE. If not, see <https://www.gnu.org/licenses/>.
 */
package smile.daemon;

import java.nio.file.Path;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import java.util.function.Supplier;
import ioa.agent.Agent;
import ioa.llm.client.LLM;
import ioa.llm.client.StreamResponseHandler;
import ioa.llm.tool.Question;
import ioa.llm.tool.Tool;
import smile.daemon.DaemonMessage.*;

/**
 * The agent-backed, INTERACTIVE chat session (ADR-0005, ADR-0006). Constructs Clair
 * (the Analyst agent) ONCE, then runs a multi-turn loop: await a user message, stream
 * the agent's response for that turn, go idle, await the next message — reusing the
 * same {@link ioa.llm.Conversation} so context accumulates across turns. One turn
 * streams at a time (the Conversation is shared mutable state).
 *
 * <p>Callback → protocol mapping per turn:
 * <ul>
 *   <li>{@code onNext} → {@link AgentChunk}; {@code onStatus} → bracketed chunk</li>
 *   <li>{@code onToolCallStatus} → {@link ToolCallMsg} (collapsible card)</li>
 *   <li>{@code onQuestion} → {@link GateOpened}; the user's free-text answer resolves it
 *       via {@link RunControl#awaitGate} and is passed to {@link Question#complete}</li>
 *   <li>{@code onComplete}/{@code onException} → {@link TurnFinished}</li>
 * </ul>
 *
 * @author Haifeng Li
 */
public class AgentRunSource implements RunSource {
    private static final org.jboss.logging.Logger LOG = org.jboss.logging.Logger.getLogger(AgentRunSource.class);

    /**
     * Serializes agent construction across ALL sessions in this JVM. {@code Agent.Spec.of}
     * loads skill resources via {@code smile.io.Paths.resource}, which lazily initializes a
     * zip {@code FileSystem} for the ioa-agent jar with a non-atomic check-then-act
     * ({@code Path.of(uri)} → on miss → {@code FileSystems.newFileSystem(uri)}).
     *
     * <p>This is NOT already safe via class-init: {@code Agent.Spec} is a separate class with
     * no static initializer, so {@code Spec.of("analyst")} touches the jar (Agent.java:179)
     * BEFORE {@code Agent.<clinit>} (which would otherwise warm the FS) ever runs. So two
     * sessions constructing concurrently — two WebSocket connections, a reconnect, or (the
     * bug this fixes) a StrictMode dev double-mount opening a second socket — both find the FS
     * absent and the loser throws {@code FileSystemAlreadyExistsException} (empirically
     * reproduced: 5/6 concurrent threads threw). Smile's {@code Paths} is a vendored library
     * we don't modify; serializing the first construction here makes one thread create the
     * cached filesystem and every later call (sessions AND the subagents Tool.planning() can
     * spawn — all built-in agent types live in the same jar/URI) take the fast already-exists
     * path. Construction is one-time-per-session, so the lock is not on any hot path.
     */
    private static final Object AGENT_INIT_LOCK = new Object();

    private final String sessionId;
    private final Path workingDir;
    private final Supplier<LLM> llmFactory;
    private final String greeting;
    private final AtomicInteger seq = new AtomicInteger();

    public AgentRunSource(String sessionId, Path workingDir, Supplier<LLM> llmFactory, String greeting) {
        this.sessionId = sessionId;
        this.workingDir = workingDir;
        this.llmFactory = llmFactory;
        this.greeting = greeting;
    }

    @Override
    public void run(Consumer<DaemonMessage> emit, RunControl control) {
        emit.accept(new SessionStarted(sessionId, greeting));

        Agent agent;
        LLM llm;
        try {
            // Serialize construction across sessions (see AGENT_INIT_LOCK): Agent.Spec.of
            // lazily inits a zip filesystem via smile.io.Paths with a non-atomic
            // check-then-act, so concurrent construction otherwise throws
            // FileSystemAlreadyExistsException.
            synchronized (AGENT_INIT_LOCK) {
                var spec = Agent.Spec.of("analyst");
                llm = llmFactory.get();
                agent = new Agent(spec, () -> llm, workingDir);
                // Clair's skills run Python, read/write files, and visualize data.
                agent.conversation().addTools(Tool.file());
                agent.conversation().addTools(Tool.shell());
                agent.conversation().addTools(Tool.data());
                agent.conversation().addTools(Tool.planning());
            }
        } catch (Throwable t) {
            LOG.error("Failed to initialize Clair agent", t);
            emit.accept(new AgentChunk(sessionId, "Failed to initialize the agent: " + t.getMessage()));
            emit.accept(new RunFinished(sessionId, "failed"));
            return;
        }

        // Watch the working dir for the automl skill's output files and surface them as
        // structured stages/artifacts (ADR-0006). One watcher for the whole session; it
        // seeds the pipeline timeline on first start and dedupes across turns.
        var watcher = new RunArtifactWatcher(sessionId, workingDir, emit);

        // Multi-turn loop: one user message -> one streamed agent turn -> idle.
        LOG.infof("Agent session %s ready; awaiting first user message", sessionId);
        while (!control.isClosed()) {
            Optional<String> next = control.takeUserMessage();
            if (next.isEmpty()) break; // session closed
            control.clearCancel();
            watcher.start(); // idempotent; begins seeding stages on the first real turn
            streamTurn(agent, llm, next.get(), emit, control);
            LOG.infof("Agent session %s idle; awaiting next user message", sessionId);
        }
        watcher.stop();
        LOG.debug("Chat session ended");
    }

    /**
     * Stream a single user turn to completion. We call {@code llm.complete(prompt,
     * conversation, handler)} DIRECTLY rather than {@code agent.stream(...)}: the latter
     * wraps our handler in an internal {@code Agent$1} that overrides only onNext/
     * onComplete/onException/onStatus/onQuestion and drops {@code onToolCallStatus}
     * (verified in bytecode) — so tool-call cards and the todo plan would never fire.
     * Calling complete directly makes OUR handler the one the SDK invokes for every
     * callback, while we replicate the one thing Agent.stream does first: seed the
     * system prompt into the conversation params.
     *
     * CRITICAL INVARIANT (verified against the SDK): complete() dispatches the LLM call
     * on the SDK's own async thread and returns immediately; the terminal callback
     * (onComplete/onException) fires on that thread. This method must NOT return until
     * that terminal callback has fired — otherwise the next turn would overlap this one
     * on the shared mutable Conversation. Cancellation sets the round-boundary
     * INTERRUPTED flag and then STILL waits for the terminal callback.
     */
    private void streamTurn(Agent agent, LLM llm, String userText, Consumer<DaemonMessage> emit, RunControl control) {
        String turnId = "turn-" + seq.incrementAndGet();
        emit.accept(new TurnStarted(turnId, "agent"));
        var doneLatch = new CountDownLatch(1);
        // Guards a single TurnFinished + single latch countdown across the SDK threads.
        var terminated = new AtomicBoolean(false);
        // Diagnostic counters: a stall after skill-load shows as chunks>0 but toolCalls==0 and
        // no terminal callback — the heartbeat below makes that visible instead of dead silence.
        var chunkCount = new AtomicInteger();
        var toolCallCount = new AtomicInteger();
        // Last time the SDK delivered ANY callback (chunk/status/tool-call/gate). If this goes
        // quiet while the latch is still open, the LLM stream was silently dropped (no terminal
        // onComplete/onException) — the stall detector below makes that visible.
        var lastActivityNanos = new AtomicLong(System.nanoTime());
        LOG.infof("[%s] turn START (userText %d chars)", turnId, userText.length());

        // Reset the interrupt flag at the START of the turn (never in a finally that could
        // run while the prior stream is still alive).
        agent.conversation().params().setProperty(LLM.INTERRUPTED, "false");

        var handler = new StreamResponseHandler() {
            @Override
            public void onNext(String chunk) {
                lastActivityNanos.set(System.nanoTime());
                chunkCount.incrementAndGet();
                emit.accept(new AgentChunk(sessionId, chunk));
            }

            @Override
            public void onStatus(String status) {
                lastActivityNanos.set(System.nanoTime());
                if (status != null && !status.isBlank()) {
                    LOG.infof("[%s] status: %s", turnId, status);
                    emit.accept(new AgentChunk(sessionId, "\n[" + status + "]\n"));
                }
            }

            @Override
            public void onToolCallStatus(ioa.llm.tool.Tool tool, ioa.llm.tool.Tool.Result result) {
                lastActivityNanos.set(System.nanoTime());
                // R1: TodoWrite carries the agent's task plan — surface it as a live
                // checklist (a TodoList message), not a noisy generic tool-call card.
                if (tool instanceof ioa.llm.tool.TodoWrite tw && tw.todos != null) {
                    LOG.infof("[%s] todo-write (%d items)", turnId, tw.todos.size());
                    var todos = tw.todos.stream()
                            .map(t -> new Todo(t.content, t.status, t.activeForm))
                            .toList();
                    emit.accept(new TodoList(sessionId, todos));
                    return;
                }
                // R2: present the tool with a real kind + input preview, not kind="script".
                ToolPresenter.Card card = ToolPresenter.present(tool);
                String id = "tc-" + seq.incrementAndGet();
                boolean done = result != null;
                LOG.infof("[%s] tool-call #%d: %s '%s' (%s)", turnId, toolCallCount.incrementAndGet(),
                        card.kind(), card.title(), done ? (result.success() ? "done" : "failed") : "running");
                String status = done ? (result.success() ? "done" : "failed") : "running";
                // Prefer the result's command for the title once complete, else the card title.
                String title = done && result.command() != null && !result.command().isBlank()
                        ? result.command() : card.title();
                String output = done ? result.output() : null;
                emit.accept(new ToolCallMsg(sessionId,
                        new ToolCall(id, title, card.kind(), status, card.code(), output, null)));
            }

            @Override
            public void onQuestion(Question question) {
                lastActivityNanos.set(System.nanoTime());
                String gateId = "g-" + seq.incrementAndGet();
                var protoQ = new DaemonMessage.Question(
                        gateId, GateClassifier.questionHeader(question.header),
                        question.question, question.choices, question.multiSelect);
                // Pure classification (clarify vs approval) lives in GateClassifier.
                var decision = GateClassifier.classify(question.header, question.choices);
                LOG.infof("[%s] gate OPENED %s (%s) '%s' — BLOCKING for webview answer",
                        turnId, gateId, decision.kind(), decision.gateHeader());
                emit.accept(new GateOpened(sessionId,
                        new Gate(gateId, decision.kind(), decision.gateHeader(), protoQ)));
                // Block the agent thread until the webview answers; on cancel/close, abort
                // rather than fabricating an answer.
                Optional<String> answer = control.awaitGate(gateId);
                LOG.infof("[%s] gate %s RESOLVED (answered=%b, aborted=%b)", turnId, gateId,
                        answer.isPresent(), control.isCancelled() || control.isClosed());
                emit.accept(new GateClosed(sessionId, gateId));
                boolean aborted = control.isCancelled() || control.isClosed();
                question.complete(
                        GateClassifier.answerFor(aborted, decision.approval(), answer, question.choices));
            }

            @Override
            public void onComplete(long total, long output, long input) {
                if (terminated.compareAndSet(false, true)) {
                    LOG.infof("[%s] turn COMPLETE (%d chunks, %d tool-calls, %d output tokens)",
                            turnId, chunkCount.get(), toolCallCount.get(), output);
                    emit.accept(new TurnFinished(turnId, "done", output));
                    doneLatch.countDown();
                }
            }

            @Override
            public void onException(Throwable ex) {
                LOG.errorf(ex, "[%s] turn EXCEPTION after %d chunks, %d tool-calls",
                        turnId, chunkCount.get(), toolCallCount.get());
                if (terminated.compareAndSet(false, true)) {
                    emit.accept(new AgentChunk(sessionId, "\nError: " + ex.getMessage()));
                    emit.accept(new TurnFinished(turnId, "failed", 0));
                    doneLatch.countDown();
                }
            }
        };

        boolean interruptRequested = false;
        try {
            // Replicate what Agent.stream does before delegating, then call complete()
            // directly so OUR handler (incl. onToolCallStatus) is what the SDK invokes.
            agent.conversation().params().setProperty(LLM.SYSTEM_PROMPT, agent.system());
            // Prepend the current data context (DuckDB tables + input/ files) so the agent
            // knows what data exists WITHOUT the user loading a file or naming a path — and
            // so a "Save as table" DuckDB table is visible to summarize/AutoML. Bounded and
            // best-effort; empty when there's genuinely no data yet.
            String prompt = DataContext.preamble(workingDir) + userText;
            LOG.infof("[%s] dispatching llm.complete (prompt %d chars incl. data-context preamble)",
                    turnId, prompt.length());
            llm.complete(prompt, agent.conversation(), handler);
            // Wait for a terminal callback. On cancel/close, raise INTERRUPTED (consumed
            // at the SDK's next round boundary) but KEEP waiting so the turn is quiescent
            // before we return — preserving the one-turn-at-a-time invariant.
            // A heartbeat logs every ~10s so a stall (no terminal callback, no tool-call) is
            // visible as "still waiting" lines with counts/elapsed, not dead silence.
            // No-activity threshold for the silent-stall detector: if the SDK delivers no
            // callback for this long while the turn is still open, the LLM stream was almost
            // certainly dropped without a terminal onComplete/onException (observed: a Bedrock
            // HTTP/2 stream silently dies, the SDK's error path never fires, and this loop would
            // otherwise wait forever with no clue). A normal LLM round streams chunks well
            // within this window, so it won't false-positive on legitimate work.
            final long STALL_THRESHOLD_MS = 60_000;
            long startNanos = System.nanoTime();
            int beats = 0;
            boolean stallWarned = false;
            while (!doneLatch.await(200, TimeUnit.MILLISECONDS)) {
                if (!interruptRequested && (control.isCancelled() || control.isClosed())) {
                    agent.conversation().params().setProperty(LLM.INTERRUPTED, "true");
                    interruptRequested = true;
                }
                long now = System.nanoTime();
                long elapsedMs = (now - startNanos) / 1_000_000;
                if (elapsedMs / 10_000 > beats) {
                    beats = (int) (elapsedMs / 10_000);
                    LOG.infof("[%s] still waiting for terminal callback — %ds elapsed, %d chunks, %d tool-calls%s",
                            turnId, elapsedMs / 1000, chunkCount.get(), toolCallCount.get(),
                            interruptRequested ? " (interrupt requested)" : "");
                }
                // Silent-stall detection: warn ONCE when activity goes quiet past the threshold;
                // re-arm if a callback arrives (activity timestamp moves) so a later stall warns again.
                long idleMs = (now - lastActivityNanos.get()) / 1_000_000;
                if (idleMs >= STALL_THRESHOLD_MS && !stallWarned) {
                    stallWarned = true;
                    LOG.warnf("[%s] SILENT STALL: no SDK callback for %ds (%d chunks, %d tool-calls so far). "
                            + "The LLM stream likely dropped with no terminal callback — check the "
                            + "com.openai/okhttp3 DEBUG logs above for a transport error or dropped stream. "
                            + "The turn will remain open until cancelled or the connection closes.",
                            turnId, idleMs / 1000, chunkCount.get(), toolCallCount.get());
                } else if (idleMs < STALL_THRESHOLD_MS && stallWarned) {
                    stallWarned = false; // activity resumed — re-arm for a future stall
                    LOG.infof("[%s] activity resumed after a stall", turnId);
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Throwable t) {
            LOG.error("Agent turn threw synchronously", t);
            if (terminated.compareAndSet(false, true)) {
                emit.accept(new AgentChunk(sessionId, "\nError: " + t.getMessage()));
                emit.accept(new TurnFinished(turnId, "failed", 0));
            }
        }
    }
}
