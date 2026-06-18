/**
 * LLM configuration dialog (ADR-0001), mirroring Smile Studio's Settings: AI service
 * (provider), API key, base URL, model. Config persists via the Shell (store +
 * keychain); the key field is write-only — a stored key shows as "set" but its value
 * is never read back.
 */
import { useEffect, useState } from "react";
import { getLlmConfig, setLlmConfig, PROVIDERS, type LlmConfig } from "../daemon/llmConfig";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [provider, setProvider] = useState<LlmConfig["provider"]>("bedrock");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getLlmConfig().then((c) => {
      setProvider(c.provider);
      setBaseUrl(c.baseUrl);
      setModel(c.model);
      setHasKey(c.hasKey);
      setLoaded(true);
    });
  }, []);

  const needsBaseUrl = PROVIDERS.find((p) => p.id === provider)?.needsBaseUrl ?? false;
  const canSave = !!model && (!needsBaseUrl || !!baseUrl) && (hasKey || !!apiKey);

  async function save() {
    setSaving(true);
    try {
      await setLlmConfig({ provider, baseUrl, model }, apiKey);
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

        <label className="field">
          <span>API Key{hasKey && <em className="key-set"> · stored</em>}</span>
          <input
            type="password"
            value={apiKey}
            placeholder={hasKey ? "•••••••• (leave blank to keep)" : "Enter API key / token"}
            onChange={(e) => setApiKey(e.target.value)}
          />
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
