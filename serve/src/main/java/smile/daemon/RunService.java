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
import java.util.function.Consumer;
import java.util.function.Supplier;
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import ioa.llm.client.ChatCompletions;
import ioa.llm.client.LLM;

/**
 * Supplies the {@link RunSource} that drives AutoML Runs (ADR-0005). Selects between
 * the bundled {@link ScriptedRunSource} (default; demo/offline/tests) and the
 * agent-backed {@link AgentRunSource} (Clair's {@code automl} skill) based on
 * {@code smile.daemon.engine}. No transport or frontend code changes when switching.
 *
 * @author Haifeng Li
 */
@ApplicationScoped
public class RunService {
    /** Emission pacing for the scripted source, in milliseconds. */
    private static final long STEP_MILLIS = 300;

    /** {@code scripted} (default) or {@code agent}. */
    @ConfigProperty(name = "smile.daemon.engine", defaultValue = "scripted")
    String engine;

    /**
     * LLM provider for the agent engine:
     * {@code anthropic} | {@code openai} | {@code gemini} (native), or
     * {@code bedrock} (Claude on Bedrock via the OpenAI-compatible ChatCompletions API —
     * base URL from {@code smile.daemon.llm.baseUrl}, bearer token from the
     * {@code AWS_BEARER_TOKEN_BEDROCK} environment variable).
     */
    @ConfigProperty(name = "smile.daemon.llm.provider", defaultValue = "anthropic")
    String provider;

    /** LLM model id for the agent engine (e.g. a Bedrock model id for the bedrock provider). */
    @ConfigProperty(name = "smile.daemon.llm.model", defaultValue = "claude-opus-4-8")
    String model;

    /** Base URL for the OpenAI-compatible {@code bedrock} provider (Bedrock gateway endpoint). */
    @ConfigProperty(name = "smile.daemon.llm.baseUrl", defaultValue = "")
    String baseUrl;

    /** Default analysis prompt for the agent engine when the webview sends none. */
    @ConfigProperty(name = "smile.daemon.prompt",
            defaultValue = "Run AutoML on the dataset in the current working directory and report the best model.")
    String prompt;

    /**
     * Starts a run on a worker thread, delivering messages to {@code emit} and reading
     * gate/cancel signals from {@code control}.
     */
    public void start(Consumer<DaemonMessage> emit, RunControl control) {
        RunSource source = newRunSource();
        Thread worker = new Thread(() -> source.run(emit, control), "automl-run");
        worker.setDaemon(true);
        worker.start();
    }

    /** Creates the active {@link RunSource} per the {@code smile.daemon.engine} setting. */
    protected RunSource newRunSource() {
        if ("agent".equalsIgnoreCase(engine)) {
            String runId = "run-" + Long.toHexString(System.nanoTime());
            Path cwd = Path.of(System.getProperty("user.dir"));
            return new AgentRunSource(runId, prompt, cwd, this::newLlm);
        }
        return new ScriptedRunSource(STEP_MILLIS);
    }

    /**
     * Builds the LLM client for the agent engine. For {@code bedrock}, uses the
     * OpenAI-compatible {@link ChatCompletions} client pointed at {@code baseUrl} with
     * the bearer token from {@code AWS_BEARER_TOKEN_BEDROCK} — the same path the studio
     * uses for Claude on Bedrock. Otherwise uses the native provider via {@link LLM#of}.
     */
    private LLM newLlm() {
        if ("bedrock".equalsIgnoreCase(provider)) {
            String token = System.getenv("AWS_BEARER_TOKEN_BEDROCK");
            if (token == null || token.isBlank()) {
                throw new IllegalStateException(
                        "bedrock provider requires the AWS_BEARER_TOKEN_BEDROCK environment variable");
            }
            if (baseUrl == null || baseUrl.isBlank()) {
                throw new IllegalStateException(
                        "bedrock provider requires smile.daemon.llm.baseUrl (the Bedrock OpenAI-compatible endpoint)");
            }
            return new ChatCompletions(baseUrl, token, model);
        }
        return LLM.of(provider, model);
    }
}
