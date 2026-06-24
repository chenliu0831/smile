/**
 * The Scorecard (S5, ADR-0011): a persistent metric strip above the canvas, sourced from the
 * `metrics` artifact (final_metrics.json inlined in `meta`). It self-configures the run
 * framing — problem type · primary metric · CV · rows — and shows the headline scores as
 * they complete. Hidden entirely when no metrics artifact is present (graceful absence).
 *
 * Not an artifact-canvas branch: it's chrome that persists across view switches, reading the
 * metrics artifact via a selector.
 */
import { useMemo } from "react";
import { useStore } from "zustand";
import { useRunContext } from "../store/RunContext";
import { selectMetrics } from "../store/selectors";
import { parseMetrics } from "../lib/metrics";

export function Scorecard() {
  const { store } = useRunContext();
  const artifact = useStore(store, (s) => selectMetrics(s.session));
  const metrics = useMemo(() => (artifact ? parseMetrics(artifact.meta) : null), [artifact]);

  if (!metrics) return null;

  const framing = [
    metrics.taskType,
    metrics.primaryMetric,
    metrics.cv,
    metrics.rows != null ? `${metrics.rows} rows` : undefined,
  ].filter(Boolean);

  return (
    <div className="scorecard" data-testid="scorecard">
      {framing.length > 0 && (
        <div className="scorecard-framing">{framing.join(" · ")}</div>
      )}
      <div className="scorecard-scores">
        {metrics.scores.map((s) => (
          <span key={s.label} className="scorecard-score" title={`source: final_metrics.json → ${s.source}`}>
            <span className="scorecard-label">{s.label}</span>
            <b>{s.value.toFixed(3)}</b>
          </span>
        ))}
        {metrics.ensembleMethod && (
          <span className="scorecard-ensemble">ensemble: {metrics.ensembleMethod}</span>
        )}
      </div>
    </div>
  );
}
