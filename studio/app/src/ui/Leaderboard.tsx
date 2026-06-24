/**
 * Renders a Leaderboard artifact (ADR-0004/0005) as an INTERACTIVE ranked table (S6):
 * sortable columns, score bars coloured by model type (ensemble/tuned/default), ±std
 * whiskers shown only where std is finite, and an ensemble-vs-base-learners verdict.
 *
 * A projection of the agent's `candidate_scores.md` / `summary.md` — not a backend table.
 * All ranking math is pure (../lib/leaderboard); this component holds only the sort key.
 */
import { Fragment, useMemo, useState } from "react";
import {
  parseLeaderboard,
  defaultMetric,
  sortCandidates,
  ensembleVerdict,
  type ProblemType,
  type SortKey,
} from "../lib/leaderboard";
import { type ParamsByModel, paramsForModel, toPythonDict, paramDeltas } from "../lib/params";

const TYPE_COLOR: Record<string, string> = {
  ensemble: "var(--gold)",
  tuned: "var(--accent)",
  default: "var(--text-dim)",
};

export function Leaderboard({
  markdown,
  problemType = "binary",
  paramsByModel,
}: {
  markdown: string;
  problemType?: ProblemType;
  /** Tuned hyperparameters by model (S7) — enables per-row drill-down when present. */
  paramsByModel?: ParamsByModel;
}) {
  // problemType defaults to binary; S5 threads the run's real task_type in so the metric
  // label/direction is correct for regression/multiclass.
  const spec = defaultMetric(problemType);
  const board = useMemo(() => parseLeaderboard(markdown, spec), [markdown, spec.metric, spec.higherIsBetter]);

  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const rows = useMemo(
    () => sortCandidates(board.rows, sortKey, board.higherIsBetter),
    [board.rows, sortKey, board.higherIsBetter],
  );
  const verdict = useMemo(() => ensembleVerdict(board), [board]);

  // Bar widths are scaled to the max finite score so relative performance is legible.
  const maxScore = Math.max(...board.rows.map((r) => r.score).filter(Number.isFinite), 0) || 1;

  const Header = ({ k, label }: { k: SortKey; label: string }) => (
    <th
      className="lb-sortable"
      aria-sort={sortKey === k ? "ascending" : "none"}
      onClick={() => setSortKey(k)}
    >
      {label}{sortKey === k ? " ↓" : ""}
    </th>
  );

  return (
    <div>
      <p style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 0 }}>
        Ranked by <strong>{board.metric}</strong> ·{" "}
        {board.higherIsBetter ? "higher is better" : "lower is better"} · sortable
      </p>
      <table className="grid">
        <thead>
          <tr>
            <th className="rank">#</th>
            <Header k="name" label="Candidate" />
            <Header k="score" label={board.metric} />
            <th>Std</th>
            <th>Params</th>
            <Header k="runtimeSec" label="Runtime" />
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const width = Number.isFinite(r.score) ? Math.max(2, (r.score / maxScore) * 100) : 0;
            // ±std whisker width relative to the bar scale (only when std is finite).
            const whisker = Number.isFinite(r.std as number) ? ((r.std as number) / maxScore) * 100 : null;
            const mp = paramsByModel ? paramsForModel(paramsByModel, r.name) : undefined;
            const isOpen = expanded === r.name;
            return (
              <Fragment key={r.name}>
                <tr className={i === 0 ? "best" : ""}>
                  <td className="rank">{i === 0 ? <span className="medal">★</span> : i + 1}</td>
                  <td>
                    {mp ? (
                      <button
                        type="button"
                        className="lb-expand"
                        aria-expanded={isOpen}
                        onClick={() => setExpanded(isOpen ? null : r.name)}
                      >
                        {isOpen ? "▾" : "▸"} {r.name}
                      </button>
                    ) : (
                      r.name
                    )}
                  </td>
                  <td className="score">
                    <div className="lb-bar-cell">
                      <span
                        className="lb-bar"
                        style={{ width: `${width}%`, background: TYPE_COLOR[r.modelType] }}
                      >
                        {whisker != null && (
                          <span className="lb-whisker" style={{ width: `${Math.min(whisker, width)}%` }} />
                        )}
                      </span>
                      <span className="lb-score-num">{Number.isFinite(r.score) ? r.score.toFixed(4) : "—"}</span>
                    </div>
                  </td>
                  <td className="score">{Number.isFinite(r.std as number) ? `±${(r.std as number).toFixed(3)}` : "—"}</td>
                  <td style={{ color: "var(--text-dim)" }}>{r.params ?? "—"}</td>
                  <td className="score">{r.runtimeSec != null ? `${r.runtimeSec}s` : "—"}</td>
                  <td>
                    <span className="lb-type" style={{ color: TYPE_COLOR[r.modelType] }}>{r.modelType}</span>
                  </td>
                </tr>
                {isOpen && mp && (
                  <tr className="lb-params-row" data-testid="lb-params">
                    <td colSpan={7}>
                      <div className="lb-params">
                        <div className="lb-params-head">
                          <span>Tuned hyperparameters</span>
                          <button
                            type="button"
                            className="lb-copy"
                            onClick={() => {
                              const dict = toPythonDict(mp.params);
                              void navigator.clipboard?.writeText(dict);
                              setCopied(r.name);
                            }}
                          >
                            {copied === r.name ? "copied ✓" : "copy as Python dict"}
                          </button>
                        </div>
                        <table className="lb-params-table">
                          <thead>
                            <tr><th>param</th><th>tuned</th>{mp.defaults && <th>default</th>}</tr>
                          </thead>
                          <tbody>
                            {paramDeltas(mp).map((d) => (
                              <tr key={d.key} className={d.changed ? "lb-param-changed" : ""}>
                                <td>{d.key}</td>
                                <td>{String(d.tuned)}</td>
                                {mp.defaults && <td>{d.default !== undefined ? String(d.default) : "—"}</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {verdict && (
        <div className="lb-verdict">
          <b>{verdict.ensemble.name}</b>{" "}
          {verdict.beatsBest ? "beats" : "does not beat"} the best base learner{" "}
          <b>{verdict.bestBase.name}</b> by{" "}
          <span style={{ color: verdict.beatsBest ? "var(--good)" : "var(--bad)" }}>
            {verdict.lift >= 0 ? "+" : ""}{verdict.lift.toFixed(4)} {board.metric}
          </span>.
        </div>
      )}
    </div>
  );
}
