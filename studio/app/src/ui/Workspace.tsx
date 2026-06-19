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
import { useEffect, useMemo, useRef, useState } from "react";
import { RunProvider, useRunContext } from "../automl/RunContext";
import { Topbar } from "./Topbar";
import { AgentStream } from "./AgentStream";
import { ChatWelcome } from "./ChatWelcome";
import { ViewRail, type CanvasView, type ViewDef } from "./ViewRail";
import { Timeline } from "./Timeline";
import { Canvas } from "./Canvas";
import { SqlConsole } from "./SqlConsole";

function WorkspaceInner() {
  const c = useRunContext();
  const { state, datasetInfo, dataset, canLoadDataset, loadDataset, sendMessage } = c;

  const hasDataset = !!datasetInfo || !!dataset;
  const hasArtifacts = Object.keys(state.artifacts).length > 0;
  const hasStages = state.stages.length > 0;
  // Find the leaderboard by KIND, not by ref: the real daemon emits it under ref
  // "candidates" (the stage id), only the mock uses ref "leaderboard". Keying on the ref
  // left the Leaderboard view permanently disabled and never auto-revealed on real runs.
  const leaderboard = Object.values(state.artifacts).find((a) => a.kind === "leaderboard");
  // The "Data" view IS the SQL console (Phase 2): it needs the daemon's /sql endpoint (the
  // shared DuckDB session). It works with a daemon even before a file is "loaded" — the
  // agent may have created tables, and the user can query the input file directly.
  const hasDaemon = !!c.httpBase;
  const hasData = hasDataset || hasDaemon;
  // The canvas is worth showing once there's data or a run producing artifacts/stages.
  // (The Data/SQL view can additionally be opened on demand — see canvasOpen below.)
  const canvasReady = hasDataset || hasArtifacts || hasStages;

  const views: ViewDef[] = useMemo(
    () => [
      { id: "overview", label: "Overview", icon: "◫", enabled: canvasReady },
      { id: "data", label: "Data", icon: "⌗", enabled: hasData },
      { id: "pipeline", label: "Pipeline", icon: "▸", enabled: hasStages },
      { id: "leaderboard", label: "Leaderboard", icon: "★", enabled: !!leaderboard },
    ],
    [canvasReady, hasData, hasStages, leaderboard, state.artifacts],
  );

  const [view, setView] = useState<CanvasView>("overview");
  // The agent's "Open in console" injects a statement into the SQL editor (the Data view).
  // A counter keys the prop so re-opening the SAME statement still triggers the inject.
  const [injectedSql, setInjectedSql] = useState<{ sql: string; n: number } | null>(null);
  const openSql = (sql: string) => {
    setUserPicked(true);
    setView("data");
    setInjectedSql((prev) => ({ sql, n: (prev?.n ?? 0) + 1 }));
  };
  // Auto-reveal the most relevant view as the workflow progresses, without yanking the
  // user off a view they explicitly chose. Fires only when the COMPUTED target changes
  // (new stage progress / leaderboard / artifact arrives) — not merely because userPicked
  // flipped — so Reset can return to Overview and stay there until real new data appears.
  const [userPicked, setUserPicked] = useState(false);
  // The pipeline view is only worth revealing once a stage is actually running/done — the
  // watcher seeds the whole timeline as `pending` up front, so gating on hasStages alone
  // would latch on 'pipeline' and never advance to the leaderboard (audit #9).
  const pipelineLive = state.stages.some((s) => s.status !== "pending");
  const autoTarget: CanvasView | null = leaderboard
    ? "leaderboard"
    : pipelineLive ? "pipeline"
    : hasArtifacts ? "overview"   // a summarize-only turn produces an artifact but no stages
    : hasDataset ? "data" : null;
  // Re-arm auto-navigation on each new user turn (fresh run intent): clear the user-picked
  // latch AND the last-target memo, so the next run's view reveals even if the user switched
  // views earlier and even if the new run lands on the SAME view kind as the prior one
  // (audit #12). Computed inline so the auto-reveal effect below sees the re-armed state.
  const userTurnCount = state.turns.filter((t) => t.role === "user").length;
  const lastAutoTarget = useRef<CanvasView | null>(null);
  const lastUserTurn = useRef(0);
  if (userTurnCount !== lastUserTurn.current) {
    lastUserTurn.current = userTurnCount;
    lastAutoTarget.current = null; // re-arm target memo for the new turn
  }
  useEffect(() => {
    if (userTurnCount > 0) setUserPicked(false);
  }, [userTurnCount]);

  useEffect(() => {
    if (autoTarget && autoTarget !== lastAutoTarget.current) {
      lastAutoTarget.current = autoTarget;
      if (!userPicked) setView(autoTarget);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTarget, userTurnCount]);

  const welcome = (
    <ChatWelcome
      datasetName={datasetInfo?.fileName ?? dataset?.fileName ?? null}
      canLoadDataset={canLoadDataset}
      onLoadDataset={loadDataset}
      onPrompt={sendMessage}
    />
  );

  // The canvas opens automatically when there's data/run output, OR on demand when the
  // user (or an agent SQL card) opens the Data/SQL console — so the cold-start screen stays
  // chat-only until something is actually worth showing.
  const canvasOpen = canvasReady || view === "data";

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
      // The Data view IS the SQL console (Phase 2 — replaced DataPanel + DataExplorer).
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
      // Match by kind (the real daemon's ref is "candidates", not "leaderboard").
      const lb = artifacts.find((a) => a.kind === "leaderboard");
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
