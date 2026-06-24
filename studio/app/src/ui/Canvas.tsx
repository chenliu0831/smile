/**
 * The artifact canvas zone (ADR-0006): renders Run Artifacts as first-class objects —
 * reports (Markdown), the Leaderboard (Data Grid), and charts (native DataViz).
 */
import { useEffect, useState } from "react";
import type { Artifact } from "../daemon/protocol";
import type { ProblemType } from "../lib/leaderboard";
import type { ParamsByModel } from "../lib/params";
import { Markdown } from "./Markdown";
import { Leaderboard } from "./Leaderboard";
import { Chart } from "./Chart";
import { PredictionsStudio, isPredictionsArtifact } from "./PredictionsStudio";
import { PermImportanceChart } from "./PermImportanceChart";
import { ErrorBoundary } from "./ErrorBoundary";

function ArtifactView({ artifact, problemType, paramsByModel }: { artifact: Artifact; problemType?: ProblemType; paramsByModel?: ParamsByModel }) {
  if (artifact.kind === "leaderboard" && artifact.body) return <Leaderboard markdown={artifact.body} problemType={problemType} paramsByModel={paramsByModel} />;
  if (artifact.kind === "report" && artifact.body) return <Markdown source={artifact.body} />;
  if (artifact.kind === "chart" && artifact.viz) return <Chart spec={artifact.viz} />;
  // Driver Diagnostics: permutation importance carried inline in `meta` (ADR-0011).
  if (artifact.kind === "diagnostics") return <PermImportanceChart artifact={artifact} />;
  // A prediction-set dataframe (final/submission.csv → DuckDB) renders as Predictions Studio.
  if (isPredictionsArtifact(artifact)) return <PredictionsStudio artifact={artifact} />;
  // Image artifacts (summarize/EDA PNG charts) carry a base64 data: URI in body.
  if (artifact.kind === "image" && artifact.body) {
    return <img className="artifact-image" src={artifact.body} alt={artifact.title} />;
  }
  // file artifacts: surface the real path instead of a dead "No preview" tab.
  if (artifact.kind === "file" && artifact.path) {
    return (
      <div className="artifact-file">
        <div className="artifact-file-name">📄 {artifact.title}</div>
        <div className="artifact-file-path">{artifact.path}</div>
      </div>
    );
  }
  if (artifact.body) return <Markdown source={artifact.body} />;
  return <div className="canvas-empty">No preview for this artifact.</div>;
}

/** Artifacts consumed as companion/chrome data, not shown as their own canvas tab:
 * the metrics Scorecard (own strip) and the params sidecar (joined into the Leaderboard). */
function isCompanionArtifact(a: Artifact): boolean {
  return a.kind === "metrics";
}

export function Canvas({ artifacts: allArtifacts, problemType, paramsByModel }: { artifacts: Artifact[]; problemType?: ProblemType; paramsByModel?: ParamsByModel }) {
  // Companion artifacts (metrics/params) feed other surfaces; never render as a canvas tab.
  const artifacts = allArtifacts.filter((a) => !isCompanionArtifact(a));
  const [activeRef, setActiveRef] = useState<string | null>(null);

  // Follow the latest artifact as the run streams, unless the user has picked one.
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (!pinned && artifacts.length) setActiveRef(artifacts[artifacts.length - 1].ref);
  }, [artifacts, pinned]);

  const active = artifacts.find((a) => a.ref === activeRef) ?? artifacts[artifacts.length - 1];

  return (
    <div className="zone canvas">
      {artifacts.length === 0 ? (
        <div className="canvas-empty">Artifacts will appear here as the run progresses.</div>
      ) : (
        <>
          <div className="artifact-tabs">
            {artifacts.map((a) => (
              <button
                key={a.ref}
                className={`artifact-tab ${active?.ref === a.ref ? "active" : ""}`}
                onClick={() => { setActiveRef(a.ref); setPinned(true); }}
              >
                {a.title}
              </button>
            ))}
          </div>
          {active && (
            <ErrorBoundary label={`“${active.title}”`} resetKey={active.ref}>
              <ArtifactView artifact={active} problemType={problemType} paramsByModel={paramsByModel} />
            </ErrorBoundary>
          )}
        </>
      )}
    </div>
  );
}
