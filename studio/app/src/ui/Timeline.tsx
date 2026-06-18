import type { StageProgress } from "../daemon/protocol";

export function Timeline({
  stages,
  selectedId,
  onSelect,
}: {
  stages: StageProgress[];
  selectedId: string | null;
  onSelect: (stageId: string) => void;
}) {
  return (
    <div className="zone timeline">
      <div className="zone-title">Pipeline</div>
      {stages.map((s) => (
        <div
          key={s.stageId}
          className={`stage ${s.status} ${selectedId === s.stageId ? "selected" : ""}`}
          onClick={() => onSelect(s.stageId)}
        >
          <span className="marker" />
          <span>
            <div className="label">{s.label}</div>
            {s.detail && <div className="detail">{s.detail}</div>}
          </span>
        </div>
      ))}
    </div>
  );
}
