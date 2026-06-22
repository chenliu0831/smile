/**
 * Typed client for the Shell's LLM-config commands (ADR-0001). The provider/base
 * URL/model live in the Tauri store; the API key/token is read from the provider's
 * environment variable (e.g. AWS_BEARER_TOKEN_BEDROCK) — NOT stored by the app — so the
 * Webview only learns whether that env var is present (`hasKey`).
 *
 * Outside a Tauri window (plain browser dev) these fall back to localStorage so the
 * Settings dialog still functions (config only; there is no credential in browser dev).
 */
export interface LlmConfig {
  provider: "anthropic" | "openai" | "gemini" | "bedrock";
  baseUrl: string;
  model: string;
  /** Whether the provider's credential env var is set (value never reaches the Webview). */
  hasKey: boolean;
}

/** The environment variable each provider's credential is read from. */
export const PROVIDER_ENV_VAR: Record<LlmConfig["provider"], string> = {
  bedrock: "AWS_BEARER_TOKEN_BEDROCK",
  openai: "OPENAI_API_KEY",
  gemini: "GOOGLE_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

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
      // Browser dev can't read the credential env var, so hasKey is always false here.
      return { ...fallback, ...c, hasKey: false };
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

export async function setLlmConfig(cfg: Omit<LlmConfig, "hasKey">): Promise<void> {
  if (inTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_llm_config", {
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
    });
    return;
  }
  // Browser fallback (dev only): persist config. The credential comes from the env var,
  // which the browser can't see, so hasKey stays false here.
  localStorage.setItem(LS_KEY, JSON.stringify({ ...cfg, hasKey: false }));
}

/**
 * Set (or clear, with an empty string) a SESSION-ONLY credential for a provider — held in the
 * Shell's memory for this process only, never persisted to disk. The provider's env var still
 * takes precedence; this is the override for a launch that inherits no shell env. No-op outside
 * Tauri (browser dev has no Shell to hold it). The key value never round-trips back to the UI.
 */
export async function setSessionCredential(
  provider: LlmConfig["provider"],
  key: string,
): Promise<void> {
  if (!inTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_session_credential", { provider, key });
}
