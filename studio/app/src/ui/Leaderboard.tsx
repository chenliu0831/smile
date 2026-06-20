/**
 * Renders a Leaderboard artifact (ADR-0004/0005) as a ranked table. This is the V0
 * Data Grid; Perspective + Arrow virtualization (ADR-0007) is the production target,
 * deferred here because the candidate set is small.
 */
import { parseLeaderboard, defaultMetric } from "../automl/leaderboard";

export function Leaderboard({ markdown }: { markdown: string }) {
  // Mock run is binary churn; the daemon will send the real problem type later.
  const spec = defaultMetric("binary");
  const board = parseLeaderboard(markdown, spec);

  return (
    <div>
      <p style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 0 }}>
        Ranked by <strong>{board.metric}</strong> ·{" "}
        {board.higherIsBetter ? "higher is better" : "lower is better"} · 5-fold CV
      </p>
      <table className="grid">
        <thead>
          <tr>
            <th className="rank">#</th>
            <th>Candidate</th>
            <th>{board.metric}</th>
            <th>Std (CV)</th>
            <th>Params</th>
            <th>Runtime</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {board.rows.map((r, i) => (
            <tr key={r.name} className={i === 0 ? "best" : ""}>
              <td className="rank">{i === 0 ? <span className="medal">★</span> : i + 1}</td>
              <td>{r.name}</td>
              <td className="score">{Number.isFinite(r.score) ? r.score.toFixed(3) : "—"}</td>
              <td className="score">{Number.isFinite(r.std as number) ? (r.std as number).toFixed(3) : "—"}</td>
              <td style={{ color: "var(--text-dim)" }}>{r.params ?? "—"}</td>
              <td className="score">{r.runtimeSec != null ? `${r.runtimeSec}s` : "—"}</td>
              <td style={{ color: "var(--text-dim)" }}>{r.notes ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
