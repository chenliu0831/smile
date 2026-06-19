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
            var spec = Agent.Spec.of("analyst");
            llm = llmFactory.get();
            agent = new Agent(spec, () -> llm, workingDir);
            // Clair's skills run Python, read/write files, and visualize data.
            agent.conversation().addTools(Tool.file());
            agent.conversation().addTools(Tool.shell());
            agent.conversation().addTools(Tool.data());
            agent.conversation().addTools(Tool.planning());
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
        while (!control.isClosed()) {
            Optional<String> next = control.takeUserMessage();
            if (next.isEmpty()) break; // session closed
            control.clearCancel();
            watcher.start(); // idempotent; begins seeding stages on the first real turn
            streamTurn(agent, llm, next.get(), emit, control);
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

        // Reset the interrupt flag at the START of the turn (never in a finally that could
        // run while the prior stream is still alive).
        agent.conversation().params().setProperty(LLM.INTERRUPTED, "false");

        var handler = new StreamResponseHandler() {
            @Override
            public void onNext(String chunk) {
                emit.accept(new AgentChunk(sessionId, chunk));
            }

            @Override
            public void onStatus(String status) {
                if (status != null && !status.isBlank()) {
                    emit.accept(new AgentChunk(sessionId, "\n[" + status + "]\n"));
                }
            }

            @Override
            public void onToolCallStatus(ioa.llm.tool.Tool tool, ioa.llm.tool.Tool.Result result) {
                // R1: TodoWrite carries the agent's task plan — surface it as a live
                // checklist (a TodoList message), not a noisy generic tool-call card.
                if (tool instanceof ioa.llm.tool.TodoWrite tw && tw.todos != null) {
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
                String gateId = "g-" + seq.incrementAndGet();
                String qHeader = question.header != null ? question.header : "";
                var protoQ = new DaemonMessage.Question(
                        gateId, qHeader, question.question, question.choices, question.multiSelect);
                String header = question.header != null ? question.header : "Needs your input";
                // A choice-less question with an "approval"-style header (e.g. the SDK's
                // tool-call-limit gate, which expects exactly "Yes") is an APPROVAL gate;
                // anything else is a clarify gate the user answers with text/options.
                boolean approval = (question.choices == null || question.choices.isEmpty())
                        && header.toLowerCase().contains("approval");
                String kind = approval ? "approval" : "clarify";
                emit.accept(new GateOpened(sessionId, new Gate(gateId, kind, header, protoQ)));
                // Block the agent thread until the webview answers; on cancel/close,
                // abort rather than fabricating an answer.
                Optional<String> answer = control.awaitGate(gateId);
                emit.accept(new GateClosed(sessionId, gateId));
                if (control.isCancelled() || control.isClosed()) {
                    question.complete(approval ? "No" : "");
                } else if (approval) {
                    // The webview's Approve sends an empty answer; the SDK needs "Yes".
                    question.complete("Yes");
                } else {
                    question.complete(resolveAnswer(answer, question));
                }
            }

            @Override
            public void onComplete(long total, long output, long input) {
                if (terminated.compareAndSet(false, true)) {
                    emit.accept(new TurnFinished(turnId, "done", output));
                    doneLatch.countDown();
                }
            }

            @Override
            public void onException(Throwable ex) {
                LOG.error("Agent turn failed", ex);
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
            llm.complete(prompt, agent.conversation(), handler);
            // Wait for a terminal callback. On cancel/close, raise INTERRUPTED (consumed
            // at the SDK's next round boundary) but KEEP waiting so the turn is quiescent
            // before we return — preserving the one-turn-at-a-time invariant.
            while (!doneLatch.await(200, TimeUnit.MILLISECONDS)) {
                if (!interruptRequested && (control.isCancelled() || control.isClosed())) {
                    agent.conversation().params().setProperty(LLM.INTERRUPTED, "true");
                    interruptRequested = true;
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

    /** Pick the answer to hand the agent: user's text, else first choice, else 'proceed'. */
    private static String resolveAnswer(Optional<String> answer, Question question) {
        if (answer.isPresent() && !answer.get().isBlank()) return answer.get();
        if (question.choices != null && !question.choices.isEmpty()) return question.choices.get(0);
        return "proceed";
    }
}
