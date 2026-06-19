/**
 * The persistent left view-rail (UX revamp). Fixed chrome that can never be closed —
 * it is the recoverability backbone: it always lists every canvas view, so switching is
 * recognition, not recall (VS Code activity-bar pattern). Selecting a view swaps the
 * single canvas region; nothing here can be destroyed.
 */
export type CanvasView = "overview" | "data" | "explore" | "pipeline" | "leaderboard";

export interface ViewDef {
  id: CanvasView;
  label: string;
  icon: string;
  /** Disabled (dimmed) until its data exists — avoids dead empty views. */
  enabled: boolean;
}

export function ViewRail({
  views,
  active,
  onSelect,
  onReset,
}: {
  views: ViewDef[];
  active: CanvasView;
  onSelect: (v: CanvasView) => void;
  onReset: () => void;
}) {
  return (
    <div className="view-rail">
      <div className="rail-views">
        {views.map((v) => (
          <button
            key={v.id}
            className={`rail-btn ${active === v.id ? "active" : ""} ${v.enabled ? "" : "disabled"}`}
            onClick={() => v.enabled && onSelect(v.id)}
            disabled={!v.enabled}
            title={v.enabled ? v.label : `${v.label} — available once there's data`}
          >
            <span className="rail-icon">{v.icon}</span>
            <span className="rail-label">{v.label}</span>
          </button>
        ))}
      </div>
      <button className="rail-reset" onClick={onReset} title="Reset the workspace layout">
        ↺ Reset
      </button>
    </div>
  );
}
