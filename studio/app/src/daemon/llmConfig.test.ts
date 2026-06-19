import { beforeEach, expect, test } from "vitest";
import { getLlmConfig, setLlmConfig, PROVIDER_ENV_VAR } from "./llmConfig";

beforeEach(() => localStorage.clear());

test("defaults to bedrock with no key when nothing is stored", async () => {
  const cfg = await getLlmConfig();
  expect(cfg.provider).toBe("bedrock");
  expect(cfg.hasKey).toBe(false);
});

test("persists provider/baseUrl/model (credential is env-sourced, not stored)", async () => {
  await setLlmConfig({ provider: "bedrock", baseUrl: "https://bedrock/v1", model: "openai.gpt-oss-120b" });
  const cfg = await getLlmConfig();
  expect(cfg.provider).toBe("bedrock");
  expect(cfg.baseUrl).toBe("https://bedrock/v1");
  expect(cfg.model).toBe("openai.gpt-oss-120b");
  // In browser dev there is no env var visible, so hasKey is always false — the credential
  // is never persisted by the app.
  expect(cfg.hasKey).toBe(false);
});

test("each provider maps to its credential environment variable", () => {
  expect(PROVIDER_ENV_VAR.bedrock).toBe("AWS_BEARER_TOKEN_BEDROCK");
  expect(PROVIDER_ENV_VAR.openai).toBe("OPENAI_API_KEY");
  expect(PROVIDER_ENV_VAR.gemini).toBe("GOOGLE_API_KEY");
  expect(PROVIDER_ENV_VAR.anthropic).toBe("ANTHROPIC_API_KEY");
});
