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

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import ioa.llm.client.ChatCompletions;
import ioa.llm.client.LLM;

/**
 * Probes whether the configured LLM provider has working credentials by issuing a
 * one-shot completion. Gated behind {@code SMILE_AGENT_TEST=1}.
 *
 * @author Haifeng Li
 */
@EnabledIfEnvironmentVariable(named = "SMILE_AGENT_TEST", matches = "1")
public class LlmCredentialProbeTest {

    @Test
    public void completesAShortPrompt() throws Exception {
        String provider = System.getProperty("smile.daemon.llm.provider", "anthropic");
        String model = System.getProperty("smile.daemon.llm.model", "claude-opus-4-8");
        System.out.println("=== PROBE provider=" + provider + " model=" + model + " ===");
        System.out.println("ANTHROPIC_API_KEY set: " + (System.getenv("ANTHROPIC_API_KEY") != null));
        System.out.println("OPENAI_API_KEY set: " + (System.getenv("OPENAI_API_KEY") != null));
        System.out.println("AWS_BEARER_TOKEN_BEDROCK set: " + (System.getenv("AWS_BEARER_TOKEN_BEDROCK") != null));
        System.out.println("CLAUDE_CODE_USE_BEDROCK: " + System.getenv("CLAUDE_CODE_USE_BEDROCK"));
        try {
            LLM llm;
            if ("bedrock".equalsIgnoreCase(provider)) {
                String baseUrl = System.getProperty("smile.daemon.llm.baseUrl", "");
                System.out.println("bedrock baseUrl: " + baseUrl);
                llm = new ChatCompletions(baseUrl, System.getenv("AWS_BEARER_TOKEN_BEDROCK"), model);
            } else {
                llm = LLM.of(provider, model);
            }
            System.out.println("LLM constructed: " + llm.model());
            String reply = llm.complete("Reply with exactly: PONG").get();
            System.out.println("=== LLM REPLY: [" + reply + "] ===");
        } catch (Throwable t) {
            System.out.println("=== LLM ERROR: " + t.getClass().getName() + ": " + t.getMessage() + " ===");
            Throwable c = t.getCause();
            while (c != null) { System.out.println("  caused by: " + c.getClass().getName() + ": " + c.getMessage()); c = c.getCause(); }
        }
    }
}
