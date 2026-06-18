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
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import ioa.llm.client.ChatCompletions;
import ioa.llm.client.LLM;

/**
 * Manual integration check for the agent-backed run, gated behind
 * {@code SMILE_AGENT_TEST=1} so it never runs in CI (it makes real LLM calls and
 * needs the full classpath + credentials). Run with:
 *
 * <pre>
 * SMILE_AGENT_TEST=1 ./gradlew :serve:test --tests smile.daemon.AgentRunSourceManualTest \
 *     -Dsmile.test.cwd=/tmp/clair-run
 * </pre>
 *
 * @author Haifeng Li
 */
@EnabledIfEnvironmentVariable(named = "SMILE_AGENT_TEST", matches = "1")
public class AgentRunSourceManualTest {

    @Test
    public void clairInitializesAndStreams() throws Exception {
        Path cwd = Path.of(System.getProperty("smile.test.cwd", System.getProperty("user.dir")));
        String provider = System.getProperty("smile.daemon.llm.provider", "anthropic");
        String model = System.getProperty("smile.daemon.llm.model", "claude-opus-4-8");
        String baseUrl = System.getProperty("smile.daemon.llm.baseUrl", "");
        var source = new AgentRunSource(
                "manual-session",
                cwd,
                () -> "bedrock".equalsIgnoreCase(provider)
                        ? new ChatCompletions(baseUrl, System.getenv("AWS_BEARER_TOKEN_BEDROCK"), model)
                        : LLM.of(provider, model),
                "greeting");
        var control = new RunControl();
        var msgs = new CopyOnWriteArrayList<DaemonMessage>();

        long t0 = System.currentTimeMillis();
        Thread worker = new Thread(() -> source.run(msgs::add, control));
        worker.start();
        // Drive one interactive turn.
        control.submitUserMessage("Examine input/churn.csv, report its shape and the churn rate in two sentences.");

        // Auto-answer any gate so the turn can proceed unattended; finish on TurnFinished.
        long deadline = System.currentTimeMillis() + 240_000;
        String finished = null;
        int lastSeen = 0;
        while (System.currentTimeMillis() < deadline && worker.isAlive()) {
            for (var m : msgs) {
                if (m instanceof DaemonMessage.GateOpened g) control.resolveGate(g.gate().id(), "AUC");
                if (m instanceof DaemonMessage.TurnFinished f) finished = f.status();
            }
            // Heartbeat: print each new message type as it arrives so we can see liveness.
            for (int i = lastSeen; i < msgs.size(); i++) {
                long dt = System.currentTimeMillis() - t0;
                var m = msgs.get(i);
                String detail = m instanceof DaemonMessage.AgentChunk c
                        ? " " + c.text().replaceAll("\\s+", " ").trim() : "";
                System.out.println("[+" + dt + "ms] " + m.type() + detail);
            }
            lastSeen = msgs.size();
            if (finished != null) break;
            Thread.sleep(250);
        }
        control.close(); // end the session loop so the worker thread exits

        System.out.println("=== AGENT RUN: " + msgs.size() + " messages, finished=" + finished
                + ", elapsed=" + (System.currentTimeMillis() - t0) + "ms ===");
        msgs.stream().filter(m -> m instanceof DaemonMessage.AgentChunk)
                .map(m -> ((DaemonMessage.AgentChunk) m).text())
                .forEach(System.out::print);
        System.out.println("\n=== END ===");
    }
}
