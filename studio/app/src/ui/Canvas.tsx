/**
 * The artifact canvas zone (ADR-0006): renders Run Artifacts as first-class objects —
 * reports (Markdown), the Leaderboard (Data Grid), and charts (native DataViz).
 */
import { useEffect, useState } from "react";
import type { Artifact } from "../daemon/protocol";
import { Markdown } from "./Markdown";
import { Leaderboard } from "./Leaderboard";
import { Chart } from "./Chart";

function ArtifactView({ artifact }: { artifact: Artifact }) {
  if (artifact.kind === "leaderboard" && artifact.body) return <Leaderboard markdown={artifact.body} />;
  if (artifact.kind === "report" && artifact.body) return <Markdown source={artifact.body} />;
  if (artifact.kind === "chart" && artifact.viz) return <Chart spec={artifact.viz} />;
  if (artifact.body) return <Markdown source={artifact.body} />;
  return <div className="canvas-empty">No preview for this artifact.</div>;
}

export function Canvas({ artifacts }: { artifacts: Artifact[] }) {
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
          {active && <ArtifactView artifact={active} />}
        </>
      )}
    </div>
  );
}
