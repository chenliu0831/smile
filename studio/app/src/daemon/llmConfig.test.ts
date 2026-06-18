import { beforeEach, expect, test } from "vitest";
import { getLlmConfig, setLlmConfig } from "./llmConfig";

beforeEach(() => localStorage.clear());

test("defaults to bedrock with no key when nothing is stored", async () => {
  const cfg = await getLlmConfig();
  expect(cfg.provider).toBe("bedrock");
  expect(cfg.hasKey).toBe(false);
});

test("persists provider/baseUrl/model and reports hasKey once a key is set", async () => {
  await setLlmConfig(
    { provider: "bedrock", baseUrl: "https://bedrock/v1", model: "openai.gpt-oss-120b" },
    "secret-token",
  );
  const cfg = await getLlmConfig();
  expect(cfg.provider).toBe("bedrock");
  expect(cfg.baseUrl).toBe("https://bedrock/v1");
  expect(cfg.model).toBe("openai.gpt-oss-120b");
  expect(cfg.hasKey).toBe(true);
});

test("saving with an empty key keeps the previously-stored key flag", async () => {
  await setLlmConfig({ provider: "bedrock", baseUrl: "u", model: "m" }, "tok");
  await setLlmConfig({ provider: "bedrock", baseUrl: "u2", model: "m2" }, "");
  const cfg = await getLlmConfig();
  expect(cfg.baseUrl).toBe("u2");
  expect(cfg.hasKey).toBe(true);
});
