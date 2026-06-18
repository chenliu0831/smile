/**
 * The single-window topbar — brand, run goal, and status pill. Lives OUTSIDE
 * the dock area (above the DockviewReact shell). Extracted from RunView so the
 * three-zone Run view can live inside a dock panel without owning the chrome.
 */
import type { RunState } from "../daemon/runState";

export function Topbar({ state }: { state: Pick<RunState, "goal" | "status"> }) {
  return (
    <div className="topbar">
      <span className="brand">
        Smile<span className="dot">.</span>Studio
      </span>
      <span className="goal">{state.goal || "AutoML"}</span>
      <span className="spacer" />
      <span className={`status-pill ${state.status}`}>
        {state.status === "running"
          ? "Running"
          : state.status === "completed"
            ? "Completed"
            : state.status}
      </span>
    </div>
  );
}
