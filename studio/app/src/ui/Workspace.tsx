/**
 * The Workspace shell (UX revamp) — replaces the destructible 5-tab dockview with
 * "fixed chrome + one swappable canvas":
 *
 *   ┌ Topbar (global chrome) ───────────────────────────────┐
 *   │ ViewRail │      Canvas (swappable)      │  Clair chat  │
 *   │ (fixed)  │  Overview/Data/Explore/...   │  (fixed)     │
 *   └──────────┴──────────────────────────────┴─────────────┘
 *
 * The chat is permanent chrome (never closeable), the left rail always lists every view
 * (recoverability backbone), and only the centre canvas swaps. Chat-first on launch:
 * the canvas stays hidden until there's something to show, then splits in.
 */
import { useEffect, useMemo, useState } from "react";
import { RunProvider, useRunContext } from "../automl/RunContext";
import { Topbar } from "./Topbar";
import { AgentStream } from "./AgentStream";
import { ChatWelcome } from "./ChatWelcome";
import { ViewRail, type CanvasView, type ViewDef } from "./ViewRail";
import { Timeline } from "./Timeline";
import { Canvas } from "./Canvas";
import { DataPanel } from "./DataPanel";
import { DataExplorer } from "./DataExplorer";
import { SqlConsole } from "./SqlConsole";

function WorkspaceInner() {
  const c = useRunContext();
  const { state, datasetInfo, dataset, canLoadDataset, loadDataset, sendMessage } = c;

  const hasDataset = !!datasetInfo || !!dataset;
  const hasArtifacts = Object.keys(state.artifacts).length > 0;
  const hasStages = state.stages.length > 0;
  // The canvas is worth showing once there's data or a run producing artifacts/stages.
  // (The SQL view can additionally be opened on demand — see canvasOpen below — without
  // forcing the canvas open at cold start.)
  const canvasReady = hasDataset || hasArtifacts || hasStages;

  // SQL requires the real daemon's /sql endpoint (the shared DuckDB session). Gate it
  // strictly on a daemon connection — with no daemon there's nothing to query, and the
  // mock has no /sql. The agent may have created tables even before a file is "loaded".
  const hasDaemon = !!c.httpBase;
  const views: ViewDef[] = useMemo(
    () => [
      { id: "overview", label: "Overview", icon: "◫", enabled: canvasReady },
      { id: "data", label: "Data", icon: "▤", enabled: hasDataset },
      { id: "explore", label: "Explore", icon: "▦", enabled: hasDataset },
      { id: "sql", label: "SQL", icon: "⌗", enabled: hasDaemon },
      { id: "pipeline", label: "Pipeline", icon: "▸", enabled: hasStages },
      { id: "leaderboard", label: "Leaderboard", icon: "★", enabled: !!state.artifacts["leaderboard"] },
    ],
    [canvasReady, hasDataset, hasStages, hasDaemon, state.artifacts],
  );

  const [view, setView] = useState<CanvasView>("overview");
  // The agent's "Open in console" injects a statement into the SQL editor. A counter keys
  // the prop so re-opening the SAME statement still triggers the inject effect.
  const [injectedSql, setInjectedSql] = useState<{ sql: string; n: number } | null>(null);
  const openSql = (sql: string) => {
    setUserPicked(true);
    setView("sql");
    setInjectedSql((prev) => ({ sql, n: (prev?.n ?? 0) + 1 }));
  };
  // Auto-reveal the most relevant view as the workflow progresses, without yanking the
  // user off a view they explicitly chose.
  const [userPicked, setUserPicked] = useState(false);
  useEffect(() => {
    if (userPicked) return;
    if (state.artifacts["leaderboard"]) setView("leaderboard");
    else if (hasStages) setView("pipeline");
    else if (hasDataset) setView("data");
  }, [userPicked, hasDataset, hasStages, state.artifacts]);

  const welcome = (
    <ChatWelcome
      datasetName={datasetInfo?.fileName ?? dataset?.fileName ?? null}
      canLoadDataset={canLoadDataset}
      onLoadDataset={loadDataset}
      onPrompt={sendMessage}
    />
  );

  // The canvas opens automatically when there's data/run output, OR on demand when the
  // user (or an agent SQL card) opens the SQL console — so the cold-start screen stays
  // chat-only until something is actually worth showing.
  const canvasOpen = canvasReady || view === "sql";

  return (
    <div className="app">
      <Topbar />
      <div className={`workspace ${canvasOpen ? "with-canvas" : "chat-only"}`}>
        {canvasOpen && (
          <ViewRail
            views={views}
            active={view}
            onSelect={(v) => { setUserPicked(true); setView(v); }}
            onReset={() => { setUserPicked(false); setView("overview"); }}
          />
        )}
        {canvasOpen && (
          <div className="canvas-host">
            <CanvasRegion view={view} injectedSql={injectedSql} />
          </div>
        )}
        <AgentStream
          turns={state.turns}
          todos={state.todos}
          openGates={state.openGates}
          streaming={state.streaming}
          welcome={welcome}
          onSend={c.sendMessage}
          onResolveGate={c.resolveGate}
          onApproveGate={c.approveGate}
          onCancel={c.cancel}
          onOpenSql={openSql}
        />
      </div>
    </div>
  );
}

/** The single swappable canvas region; renders the selected view. */
function CanvasRegion({ view, injectedSql }: { view: CanvasView; injectedSql?: { sql: string; n: number } | null }) {
  const { state } = useRunContext();
  const artifacts = Object.values(state.artifacts);
  // Pipeline view: selecting a stage focuses the canvas on that stage's artifacts
  // (preserves the RunZones behavior).
  const [selectedStage, setSelectedStage] = useState<string | null>(null);

  switch (view) {
    case "data":
      return <DataPanel />;
    case "explore":
      return <DataExplorer />;
    case "sql":
      // Pass the {sql,n} object so re-opening the SAME statement (n increments) still
      // re-fires SqlConsole's inject effect.
      return <SqlConsole injected={injectedSql ?? null} />;
    case "pipeline": {
      const selected = state.stages.find((s) => s.stageId === selectedStage);
      const stageArtifacts = selected
        ? selected.artifactRefs.map((r) => state.artifacts[r]).filter(Boolean)
        : artifacts;
      return (
        <div className="canvas-pipeline">
          <Timeline
            stages={state.stages}
            selectedId={selectedStage}
            onSelect={(id) => setSelectedStage(id === selectedStage ? null : id)}
          />
          <Canvas artifacts={stageArtifacts} />
        </div>
      );
    }
    case "leaderboard": {
      const lb = state.artifacts["leaderboard"];
      return <Canvas artifacts={lb ? [lb] : artifacts} />;
    }
    case "overview":
    default:
      return <Canvas artifacts={artifacts} />;
  }
}

export function Workspace() {
  return (
    <RunProvider>
      <WorkspaceInner />
    </RunProvider>
  );
}
