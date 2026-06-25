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
import { RunProvider, useRunContext } from "../store/RunContext";
import { Topbar } from "./Topbar";
import { AgentStream } from "./AgentStream";
import { ErrorBoundary } from "./ErrorBoundary";
import { ChatWelcome } from "./ChatWelcome";
import { ViewRail, type CanvasView, type ViewDef } from "./ViewRail";
import { Timeline } from "./Timeline";
import { Canvas } from "./Canvas";
import { SqlConsole } from "./SqlConsole";
import { Scorecard } from "./Scorecard";
import { selectHasDataset, selectLeaderboard, selectMetrics, selectParams, selectAutoFollow } from "../store/selectors";
import { parseMetrics } from "../lib/metrics";
import { parseParams } from "../lib/params";

export function WorkspaceInner() {
  const c = useRunContext();
  const { state, datasetInfo, dataset, canLoadDataset, addData, sendMessage } = c;

  // Derived facts come from shared selectors (one definition each — see store/selectors.ts),
  // applied to the controller's already-reactive fields, not re-computed inline here and
  // again in Topbar/CanvasRegion.
  const hasDataset = selectHasDataset(datasetInfo, dataset);
  const hasArtifacts = Object.keys(state.artifacts).length > 0;
  const hasStages = state.stages.length > 0;
  const leaderboard = selectLeaderboard(state);
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
  // The selected pipeline stage is lifted here (from CanvasRegion) so Auto-follow (ADR-0017)
  // can drive the view AND the stage selection coherently under one user-picked latch.
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
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
  // Auto-follow (ADR-0017): the stage to select as the Run streams (latest stage with
  // artifacts; rests on the final report at finish), or null if nothing's followable yet.
  const followStage = selectAutoFollow(state);
  // View priority: whenever there is a followable stage — live OR rested-on-the-final-report
  // at finish — stage-following OWNS the view (Pipeline), superseding the leaderboard
  // auto-jump (one coherent "watch it work" narrative; the board stays one rail click away).
  // Leaderboard only auto-reveals when there's no followable stage at all (e.g. a
  // summarize-only turn that produced a board but no pipeline).
  const autoTarget: CanvasView | null = followStage
    ? "pipeline"
    : leaderboard ? "leaderboard"
    : pipelineLive ? "pipeline"
    : hasArtifacts ? "overview"   // a summarize-only turn produces an artifact but no stages
    : hasDataset ? "data" : null;
  const lastAutoTarget = useRef<CanvasView | null>(null);
  const lastFollowStage = useRef<string | null>(null);

  // Re-arm auto-navigation on NEW-RUN intent: a transition INTO the `running` status (the
  // first run, or a new run started after one finished). `status` flips to running only on
  // session/run-started and never on turn-finished (runState.ts), so a mid-run chat reply
  // keeps status==='running' and does NOT re-arm — auto-follow won't yank a user off a stage
  // they're reading just because they asked a question. Clears the latch, the target memos,
  // and any stale selection from the prior run.
  useEffect(() => {
    if (state.status === "running") {
      setUserPicked(false);
      lastAutoTarget.current = null;
      lastFollowStage.current = null;
      setSelectedStage(null);
    }
  }, [state.status]);

  // Auto-reveal the relevant view. Gated on `userPicked` AND re-runs when it flips: while the
  // user holds control we DON'T advance the memo, so the moment the latch clears (re-arm)
  // this re-fires and the still-pending target is written — fixing the stale-closure case
  // where a re-armed run whose target equals the prior one would otherwise never reveal.
  useEffect(() => {
    if (userPicked) return;
    if (autoTarget && autoTarget !== lastAutoTarget.current) {
      lastAutoTarget.current = autoTarget;
      setView(autoTarget);
    }
  }, [autoTarget, userPicked]);

  // Auto-follow the streaming stage — same latch discipline as the view reveal above: select
  // the followable stage as its artifacts land, never while the user holds control, and
  // re-fire when the latch clears so a re-armed run restores the selection.
  useEffect(() => {
    if (userPicked) return;
    if (followStage && followStage !== lastFollowStage.current) {
      lastFollowStage.current = followStage;
      setSelectedStage(followStage);
    }
  }, [followStage, userPicked]);

  const welcome = (
    <ChatWelcome
      datasetName={datasetInfo?.fileName ?? dataset?.fileName ?? null}
      canLoadDataset={canLoadDataset}
      onAddData={addData}
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
            onReset={() => { setUserPicked(false); setView("overview"); setSelectedStage(null); }}
          />
        )}
        {canvasOpen && (
          <div className="canvas-host">
            {/* Persistent metric strip above the swappable canvas (hidden until a metrics
                artifact arrives). Self-configures the run framing from final_metrics.json. */}
            <Scorecard />
            {/* A throw while rendering an artifact (bad report/table/chart) must NOT unmount
                the app and kill the agent WebSocket — contain it to the canvas. Keyed on
                view so switching views clears a stuck error. */}
            <ErrorBoundary label="this view" resetKey={view}>
              <CanvasRegion
                view={view}
                injectedSql={injectedSql}
                selectedStage={selectedStage}
                onSelectStage={(id) => {
                  // A manual stage click takes control — stop auto-following for this run
                  // (mirrors the userPicked latch on view selection). Click again to deselect.
                  setUserPicked(true);
                  setSelectedStage((cur) => (id === cur ? null : id));
                }}
              />
            </ErrorBoundary>
          </div>
        )}
        {/* The chat is the agent's lifeline (its WS lives in useRun); guard it too so a
            bad turn/tool-call render can't take the whole app — and the socket — down. */}
        <ErrorBoundary label="the chat">
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
        </ErrorBoundary>
      </div>
    </div>
  );
}

/** The single swappable canvas region; renders the selected view. The selected pipeline
 *  stage is owned by WorkspaceInner (so Auto-follow can drive it under the userPicked latch)
 *  and threaded in. */
function CanvasRegion({
  view,
  injectedSql,
  selectedStage,
  onSelectStage,
}: {
  view: CanvasView;
  injectedSql?: { sql: string; n: number } | null;
  selectedStage: string | null;
  onSelectStage: (stageId: string) => void;
}) {
  const { state } = useRunContext();
  const artifacts = Object.values(state.artifacts);

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
            onSelect={onSelectStage}
          />
          <Canvas artifacts={stageArtifacts} />
        </div>
      );
    }
    case "leaderboard": {
      // Match by kind (the real daemon's ref is "candidates", not "leaderboard").
      const lb = selectLeaderboard(state);
      // Thread the run's real task_type (from the metrics artifact) so the board's metric
      // labels are correct for regression/multiclass — no longer hard-coded to binary (S5).
      const metricsArtifact = selectMetrics(state);
      const problemType = metricsArtifact ? parseMetrics(metricsArtifact.meta)?.taskType : undefined;
      // Tuned-hyperparameter companion (S7), joined into the rows for the drill-down.
      const paramsArtifact = selectParams(state);
      const paramsByModel = paramsArtifact ? parseParams(paramsArtifact.meta) : undefined;
      return <Canvas artifacts={lb ? [lb] : artifacts} problemType={problemType} paramsByModel={paramsByModel} />;
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
