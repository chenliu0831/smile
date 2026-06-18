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
import java.util.List;
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
 * The agent-backed {@link RunSource} (ADR-0005): drives Clair's {@code automl} skill
 * and translates the live agent stream into {@link DaemonMessage}s.
 *
 * <p>Mapping from the {@code ioa} agent callbacks to the protocol:
 * <ul>
 *   <li>{@code onNext(text)} → {@link AgentChunk}</li>
 *   <li>{@code onToolCallStatus(tool, result)} → {@link ToolCallMsg} (collapsible card)</li>
 *   <li>{@code onQuestion(q)} → {@link GateOpened} (clarify); the webview's approval
 *       resolves the gate and completes the agent's {@link Question} future</li>
 *   <li>{@code onStatus(s)} → {@link AgentChunk} status line</li>
 *   <li>{@code onComplete}/{@code onException} → {@link RunFinished}</li>
 * </ul>
 *
 * <p>The agent emits token/tool/question events, not the daemon's structured
 * stage/artifact messages, so a single synthetic stage tracks overall progress and
 * the run's deliverables surface as {@link ToolCallMsg} cards. Richer stage/artifact
 * extraction (parsing {@code state.json} / the skill's output files) is a follow-up.
 *
 * @author Haifeng Li
 */
public class AgentRunSource implements RunSource {
    private static final org.jboss.logging.Logger LOG = org.jboss.logging.Logger.getLogger(AgentRunSource.class);
    private final String runId;
    private final String prompt;
    private final Path workingDir;
    private final Supplier<LLM> llmFactory;

    /**
     * @param runId      id for the emitted messages.
     * @param prompt     the analysis instruction for Clair.
     * @param workingDir the agent's working directory (where datasets / outputs live).
     * @param llmFactory builds the LLM client (provider/Bedrock wiring lives in the caller).
     */
    public AgentRunSource(String runId, String prompt, Path workingDir, Supplier<LLM> llmFactory) {
        this.runId = runId;
        this.prompt = prompt;
        this.workingDir = workingDir;
        this.llmFactory = llmFactory;
    }

    @Override
    public void run(Consumer<DaemonMessage> emit, RunControl control) {
        Stage working = new Stage("automl", "AutoML (Clair)", StageStatus.running, List.of(), null);
        emit.accept(new RunStarted(runId, prompt, List.of(working)));

        Agent agent;
        try {
            var spec = Agent.Spec.of("analyst");
            LLM llm = llmFactory.get();
            agent = new Agent(spec, () -> llm, workingDir);
            // Clair's automl skill runs Python scripts and reads/writes files, so the
            // conversation needs the file/shell/data/planning tool families enabled.
            agent.conversation().addTools(Tool.file());
            agent.conversation().addTools(Tool.shell());
            agent.conversation().addTools(Tool.data());
            agent.conversation().addTools(Tool.planning());
        } catch (Throwable t) {
            LOG.error("Failed to initialize Clair agent", t);
            emit.accept(new AgentChunk(runId, "Failed to initialize the agent: " + t.getMessage() + "\n"));
            emit.accept(new StageProgress(runId, new Stage("automl", "AutoML (Clair)", StageStatus.failed, List.of(), t.getMessage())));
            emit.accept(new RunFinished(runId, "failed"));
            return;
        }

        var toolSeq = new AtomicInteger();
        var handler = new StreamResponseHandler() {
            @Override
            public void onNext(String chunk) {
                emit.accept(new AgentChunk(runId, chunk));
            }

            @Override
            public void onStatus(String status) {
                if (status != null && !status.isBlank()) {
                    emit.accept(new AgentChunk(runId, "\n[" + status + "]\n"));
                }
            }

            @Override
            public void onToolCallStatus(ioa.llm.tool.Tool tool, ioa.llm.tool.Tool.Result result) {
                String id = "tc-" + toolSeq.incrementAndGet();
                boolean done = result != null;
                String status = done ? (result.success() ? "done" : "failed") : "running";
                String title = done && result.command() != null ? result.command()
                        : tool.getClass().getSimpleName();
                String output = done ? result.output() : null;
                emit.accept(new ToolCallMsg(runId, new ToolCall(id, title, "script", status, null, output, null)));
            }

            @Override
            public void onQuestion(Question question) {
                String gateId = "g-" + toolSeq.incrementAndGet();
                var protoQ = new DaemonMessage.Question(gateId, question.question, question.choices);
                String header = question.header != null ? question.header : "Needs your input";
                emit.accept(new GateOpened(runId, new Gate(gateId, "clarify", header, protoQ)));
                // Block the agent thread until the webview approves, then unblock the
                // agent by completing its question future.
                boolean ok = control.awaitGate(gateId);
                emit.accept(new GateClosed(runId, gateId));
                // Answer with the first choice when available, else a generic ack —
                // V1 approval semantics; richer answer routing is a follow-up.
                String answer = ok && question.choices != null && !question.choices.isEmpty()
                        ? question.choices.get(0) : "proceed";
                question.complete(answer);
            }

            @Override
            public void onComplete(long total, long output, long input) {
                emit.accept(new StageProgress(runId, new Stage("automl", "AutoML (Clair)", StageStatus.done, List.of(), output + " output tokens")));
                emit.accept(new RunFinished(runId, "completed"));
            }

            @Override
            public void onException(Throwable ex) {
                LOG.error("Agent run failed", ex);
                emit.accept(new AgentChunk(runId, "\nError: " + ex.getMessage() + "\n"));
                emit.accept(new StageProgress(runId, new Stage("automl", "AutoML (Clair)", StageStatus.failed, List.of(), ex.getMessage())));
                emit.accept(new RunFinished(runId, "failed"));
            }
        };

        agent.stream(prompt, handler);
    }
}
