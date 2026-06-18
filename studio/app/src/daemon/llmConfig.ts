/**
 * Typed client for the Shell's LLM-config commands (ADR-0001). The provider/base
 * URL/model live in the Tauri store; the API key/token lives in the OS keychain and
 * is never read back — the Webview only learns whether a key is present (`hasKey`).
 *
 * Outside a Tauri window (plain browser dev) these fall back to localStorage so the
 * Settings dialog still functions, minus the keychain guarantee.
 */
export interface LlmConfig {
  provider: "anthropic" | "openai" | "gemini" | "bedrock";
  baseUrl: string;
  model: string;
  /** Whether a key/token is stored (the value is never returned to the Webview). */
  hasKey: boolean;
}

export const PROVIDERS: { id: LlmConfig["provider"]; label: string; needsBaseUrl: boolean }[] = [
  { id: "anthropic", label: "Anthropic", needsBaseUrl: false },
  { id: "openai", label: "OpenAI", needsBaseUrl: false },
  { id: "gemini", label: "Google Gemini", needsBaseUrl: false },
  { id: "bedrock", label: "Amazon Bedrock (OpenAI-compatible)", needsBaseUrl: true },
];

const LS_KEY = "smile.studio.llmConfig";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getLlmConfig(): Promise<LlmConfig> {
  const fallback: LlmConfig = { provider: "bedrock", baseUrl: "", model: "", hasKey: false };
  if (inTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const cfg = await invoke<{ provider: string; base_url: string; model: string; has_key: boolean }>(
        "get_llm_config",
      );
      return {
        provider: (cfg.provider || "bedrock") as LlmConfig["provider"],
        baseUrl: cfg.base_url ?? "",
        model: cfg.model ?? "",
        hasKey: !!cfg.has_key,
      };
    } catch {
      return fallback;
    }
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      return { ...fallback, ...c, hasKey: !!c.apiKey || !!c.hasKey };
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

export async function setLlmConfig(
  cfg: Omit<LlmConfig, "hasKey">,
  apiKey: string,
): Promise<void> {
  if (inTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_llm_config", {
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      apiKey,
    });
    return;
  }
  // Browser fallback (dev only): persist config; mark hasKey if a key was entered.
  const existing = localStorage.getItem(LS_KEY);
  const prevHasKey = existing ? !!JSON.parse(existing).hasKey : false;
  localStorage.setItem(
    LS_KEY,
    JSON.stringify({ ...cfg, hasKey: apiKey ? true : prevHasKey }),
  );
}
