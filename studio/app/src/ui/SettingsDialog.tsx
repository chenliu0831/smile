/**
 * LLM configuration dialog (ADR-0001), mirroring Smile Studio's Settings: AI service
 * (provider), base URL, model, and an optional credential override. Config persists via the
 * Shell's store. The credential is read from the provider's environment variable (e.g.
 * AWS_BEARER_TOKEN_BEDROCK) when set; if it isn't, you can paste a key here — it's held in the
 * Shell's MEMORY for this session only (never written to disk, no OS-keychain re-prompts) and
 * must be re-entered each launch. On save the session reconnects so the new config takes effect.
 */
import { useEffect, useState } from "react";
import {
  getLlmConfig,
  setLlmConfig,
  setSessionCredential,
  PROVIDERS,
  credentialEnvVar,
  type LlmConfig,
} from "../daemon/llmConfig";

export function SettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [provider, setProvider] = useState<LlmConfig["provider"]>("bedrock");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [hasKey, setHasKey] = useState(false);
  /** Pasted credential override (write-only — never populated from the Shell). */
  const [credential, setCredential] = useState("");
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
  // Bedrock-aware: an Anthropic provider on a Bedrock base URL reads the Bedrock bearer token,
  // not ANTHROPIC_API_KEY (matches the Shell/daemon rule), so this tracks the base URL too.
  const envVar = credentialEnvVar(provider, baseUrl);

  async function save() {
    setSaving(true);
    try {
      await setLlmConfig({ provider, baseUrl, model });
      // If the user pasted a key, store it in-session for this provider (memory only).
      if (credential.trim()) {
        await setSessionCredential(provider, credential.trim());
      }
      // Stop the running daemon so it's re-spawned with the new config. REQUIRED: start_daemon
      // reuses a running daemon when the working dir is unchanged, so without this the new
      // provider/credential wouldn't take effect. (Previously save() stopped here but never
      // reconnected — leaving the UI stuck on a dead connection. onSaved() now reconnects.)
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("stop_daemon");
        } catch {
          /* no daemon running */
        }
      }
      onClose();
      // Reconnect so the new config takes effect immediately and the UI leaves any error state.
      onSaved?.();
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

        <label className="field">
          <span>Credential</span>
          <input
            type="password"
            autoComplete="off"
            value={credential}
            placeholder={hasKey ? "stored ✓ — paste to replace" : `paste ${provider} key, or set ${envVar}`}
            onChange={(e) => setCredential(e.target.value)}
          />
          <div className="cred-status">
            {hasKey ? (
              <em className="key-set">credential available ✓ (from {envVar} or this session)</em>
            ) : (
              <em className="key-missing">
                no credential — read from <code>{envVar}</code>, or paste one above (kept in memory
                for this session only, never saved to disk)
              </em>
            )}
          </div>
        </label>

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
