/**
 * The single-window topbar — brand, dataset loader, run status, settings. Lives
 * OUTSIDE the dock area (above the DockviewReact shell). Reads the shared controller
 * from RunContext so the Load Dataset action and the in-scope dataset chip are global.
 */
import { useState } from "react";
import { useRunContext } from "../automl/RunContext";
import { SettingsDialog } from "./SettingsDialog";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Topbar() {
  const { state, dataset, canLoadDataset, loadDataset } = useRunContext();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onLoad() {
    setError(null);
    setLoading(true);
    try {
      await loadDataset();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="topbar">
      <span className="brand">
        Smile<span className="dot">.</span>Studio
      </span>
      <span className="goal">{state.goal || "AutoML"}</span>

      {dataset ? (
        <span className="dataset-chip" title={dataset.workingDir}>
          📄 {dataset.fileName} <em>{formatSize(dataset.sizeBytes)}</em>
        </span>
      ) : null}

      <span className="spacer" />

      <button
        className="topbar-btn"
        onClick={onLoad}
        disabled={loading || !canLoadDataset}
        title={canLoadDataset ? "Load a dataset file" : "Available in the desktop app"}
      >
        {loading ? "Loading…" : dataset ? "Change Dataset" : "Load Dataset"}
      </button>

      {/* "Working" only while a turn is actually streaming; otherwise reflect that the
          session is connected/ready — not a misleading "Running" on mere connection. */}
      <span className={`status-pill ${state.streaming ? "working" : state.status}`}>
        {state.streaming
          ? "Working…"
          : state.status === "completed"
            ? "Ready"
            : state.status === "running"
              ? "Ready"
              : state.status === "idle"
                ? "Connecting…"
                : state.status}
      </span>
      <button className="icon-btn" title="Settings" onClick={() => setSettingsOpen(true)}>
        ⚙
      </button>
      {error && <span className="topbar-error" title={error}>⚠</span>}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
