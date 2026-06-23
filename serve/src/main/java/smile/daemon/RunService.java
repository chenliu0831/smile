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
import ioa.llm.client.Anthropic;
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
     *
     * <p>The native {@code anthropic} provider also speaks to Bedrock: point
     * {@code smile.daemon.llm.baseUrl} at a Bedrock endpoint and it authenticates with
     * {@code AWS_BEARER_TOKEN_BEDROCK} (the same env var) instead of an Anthropic API key —
     * mirroring the desktop Smile Studio.
     */
    @ConfigProperty(name = "smile.daemon.llm.provider", defaultValue = "anthropic")
    String provider;

    /** LLM model id for the agent engine (e.g. a Bedrock model id for the bedrock provider). */
    @ConfigProperty(name = "smile.daemon.llm.model", defaultValue = "claude-opus-4-8")
    String model;

    /** Base URL for the OpenAI-compatible {@code bedrock} provider (Bedrock gateway endpoint). */
    @ConfigProperty(name = "smile.daemon.llm.baseUrl")
    java.util.Optional<String> baseUrlOpt;

    /** Per-session WS token (ADR-0002). Absent disables auth (dev). */
    @ConfigProperty(name = "smile.daemon.token")
    java.util.Optional<String> tokenOpt;

    /** Greeting the agent session opens with. */
    @ConfigProperty(name = "smile.daemon.greeting")
    java.util.Optional<String> greetingOpt;

    private String baseUrl() { return baseUrlOpt.orElse(""); }
    private String token() { return tokenOpt.orElse(""); }
    private String greeting() {
        return greetingOpt.orElse(
                "Hi, I'm Clair — your data-science analyst. Load a dataset or ask me to analyze one, and I'll take it from there.");
    }

    /**
     * Verifies the connection's token against the configured session token (ADR-0002).
     * When no token is configured (dev), all connections are allowed.
     *
     * @param pathToken  token from a path param (unused; reserved).
     * @param queryToken token from the {@code ?token=} query parameter.
     */
    public boolean authorize(String pathToken, String queryToken) {
        String t = token();
        if (t.isBlank()) return true;
        return t.equals(queryToken) || t.equals(pathToken);
    }

    /**
     * Starts the session worker, delivering messages to {@code emit} and reading
     * user-message/gate/cancel signals from {@code control}.
     */
    public void start(Consumer<DaemonMessage> emit, RunControl control) {
        RunSource source = newRunSource();
        Thread worker = new Thread(() -> source.run(emit, control), "agent-session");
        worker.setDaemon(true);
        worker.start();
    }

    /** Creates the active {@link RunSource} per the {@code smile.daemon.engine} setting. */
    protected RunSource newRunSource() {
        if ("agent".equalsIgnoreCase(engine)) {
            String sessionId = "session-" + Long.toHexString(System.nanoTime());
            Path cwd = Path.of(System.getProperty("user.dir"));
            return new AgentRunSource(sessionId, cwd, this::newLlm, greeting());
        }
        return new ScriptedRunSource(STEP_MILLIS);
    }

    /**
     * Builds the LLM client for the agent engine. Two ways to reach Claude on Bedrock:
     * <ul>
     *   <li>{@code bedrock} — the OpenAI-compatible {@link ChatCompletions} client pointed at
     *       {@code baseUrl}, bearer token from {@code AWS_BEARER_TOKEN_BEDROCK}.</li>
     *   <li>{@code anthropic} with a Bedrock {@code baseUrl} — the NATIVE {@link Anthropic}
     *       client. Following the desktop Studio, we publish {@code baseUrl} to ioa's
     *       {@code anthropic.baseUrl} property and, when no {@code ANTHROPIC_API_KEY} is set,
     *       the {@code AWS_BEARER_TOKEN_BEDROCK} value to {@code anthropic.apiKey} — both read
     *       by the Anthropic SDK's {@code fromEnv()} when the client first initializes.</li>
     * </ul>
     * Otherwise uses the native provider via {@link LLM#of} (Anthropic against the public API
     * reads {@code ANTHROPIC_API_KEY} directly).
     */
    private LLM newLlm() {
        if ("bedrock".equalsIgnoreCase(provider)) {
            String token = System.getenv("AWS_BEARER_TOKEN_BEDROCK");
            if (token == null || token.isBlank()) {
                throw new IllegalStateException(
                        "bedrock provider requires the AWS_BEARER_TOKEN_BEDROCK environment variable");
            }
            String url = baseUrl();
            if (url.isBlank()) {
                throw new IllegalStateException(
                        "bedrock provider requires smile.daemon.llm.baseUrl (the Bedrock OpenAI-compatible endpoint)");
            }
            return new ChatCompletions(url, token, model);
        }
        if ("anthropic".equalsIgnoreCase(provider)) {
            // The native Anthropic client reads its base URL and credential from system
            // properties via the SDK's fromEnv(), which runs when the client first
            // initializes. Publish them BEFORE constructing Anthropic (its first active use).
            String url = baseUrl();
            if (!url.isBlank()) {
                System.setProperty(Anthropic.BASE_URL_PROPERTY_KEY, url);
            }
            // Bedrock base URL + no Anthropic API key ⇒ authenticate with the Bedrock bearer
            // token (the desktop Studio's exact rule). Otherwise leave credentials to fromEnv,
            // which reads ANTHROPIC_API_KEY for the public API.
            if (url.contains("bedrock") && System.getProperty(Anthropic.API_KEY_PROPERTY_KEY) == null) {
                String token = System.getenv("AWS_BEARER_TOKEN_BEDROCK");
                if (token != null && !token.isBlank()) {
                    System.setProperty(Anthropic.API_KEY_PROPERTY_KEY, token);
                }
            }
            return new Anthropic(model);
        }
        return LLM.of(provider, model);
    }
}
