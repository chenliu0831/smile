/**
 * LLM configuration dialog (ADR-0001), mirroring Smile Studio's Settings: AI service
 * (provider), base URL, model. Config persists via the Shell's store. The credential is
 * NOT entered here — it's read from the provider's environment variable (e.g.
 * AWS_BEARER_TOKEN_BEDROCK); the dialog only shows whether that var is set. This avoids the
 * OS keychain, which re-prompted for access on every `tauri dev` rebuild.
 */
import { useEffect, useState } from "react";
import { getLlmConfig, setLlmConfig, PROVIDERS, PROVIDER_ENV_VAR, type LlmConfig } from "../daemon/llmConfig";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [provider, setProvider] = useState<LlmConfig["provider"]>("bedrock");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Re-reads config (incl. whether the env credential is present) for the current provider.
  function refresh(p?: LlmConfig["provider"]) {
    getLlmConfig().then((c) => {
      setProvider(p ?? c.provider);
      setBaseUrl(c.baseUrl);
      setModel(c.model);
      setHasKey(c.hasKey);
      setLoaded(true);
    });
  }

  useEffect(() => { refresh(); }, []);

  const needsBaseUrl = PROVIDERS.find((p) => p.id === provider)?.needsBaseUrl ?? false;
  const canSave = !!model && (!needsBaseUrl || !!baseUrl);
  const envVar = PROVIDER_ENV_VAR[provider];

  async function save() {
    setSaving(true);
    try {
      await setLlmConfig({ provider, baseUrl, model });
      // Stop any running daemon so the next run is spawned with the new config.
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("stop_daemon");
        } catch {
          /* no daemon running */
        }
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="modal-title">Settings</div>

        <label className="field">
          <span>AI Service</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value as LlmConfig["provider"])}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>

        <div className="field">
          <span>Credential</span>
          <div className="cred-status">
            Read from the <code>{envVar}</code> environment variable.{" "}
            {hasKey
              ? <em className="key-set">detected ✓</em>
              : <em className="key-missing">not set — add it to your shell profile (e.g. ~/.zshrc) and relaunch</em>}
          </div>
        </div>

        <label className="field">
          <span>Base URL{needsBaseUrl ? " (required)" : " (optional)"}</span>
          <input
            type="text"
            value={baseUrl}
            placeholder={needsBaseUrl ? "https://bedrock-…/v1" : "default"}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Model</span>
          <input
            type="text"
            value={model}
            placeholder="e.g. openai.gpt-oss-120b"
            onChange={(e) => setModel(e.target.value)}
          />
        </label>

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!canSave || saving || !loaded} onClick={save}>
            {saving ? "Saving…" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
