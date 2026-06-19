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
  const { state, dataset, datasetInfo, canLoadDataset, loadDataset, mode } = useRunContext();
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

      {/* Current-dataset clue — authoritative: prefer the daemon's detected dataset (with
          dimensions, reflects what the agent actually analyzes) and fall back to the
          in-app loaded file. Consistent with Workspace's hasDataset = datasetInfo || dataset. */}
      {datasetInfo ? (
        <span className="dataset-chip" title={`The agent is working with input/${datasetInfo.fileName}`}>
          📄 {datasetInfo.fileName} <em>{datasetInfo.nrow.toLocaleString()}×{datasetInfo.ncol}</em>
        </span>
      ) : dataset ? (
        <span className="dataset-chip" title={dataset.workingDir}>
          📄 {dataset.fileName} <em>{formatSize(dataset.sizeBytes)}</em>
        </span>
      ) : null}

      <span className="spacer" />

      {/* Connection mode — so the scripted demo or a failed daemon can never masquerade
          as real analysis of the user's data. */}
      {mode === "demo" && (
        <span className="mode-badge demo" title="No daemon attached — this is a scripted sample run, not your data.">
          ● Demo
        </span>
      )}
      {mode === "error" && (
        <span className="mode-badge error" title="The analysis daemon could not start. Open Settings and check the LLM credential, then relaunch.">
          ● No daemon
        </span>
      )}

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
