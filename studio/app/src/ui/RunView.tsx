/**
 * The AutoML Run view (ADR-0006): three coordinated zones — pipeline timeline,
 * artifact canvas, agent stream — driven by a single RunState. Progressive
 * disclosure: calm by default, every layer one click away.
 *
 * `RunZones` is the three-zone body, reused inside the dockview shell's Run
 * panel (ADR-0008). It reads the shared RunController from RunContext, so the
 * topbar (chrome) and the panel see one Run. `RunView` keeps the legacy
 * standalone composition (its own provider + topbar + zones) so existing
 * usage/tests stay intact.
 */
import { useState } from "react";
import { RunProvider, useRunContext } from "../automl/RunContext";
import { Topbar } from "./Topbar";
import { Timeline } from "./Timeline";
import { Canvas } from "./Canvas";
import { AgentStream } from "./AgentStream";

/** The three-zone Run body (timeline / canvas / agent stream), no chrome. */
export function RunZones() {
  const { state, sendMessage, resolveGate, approveGate, cancel } = useRunContext();
  const [selectedStage, setSelectedStage] = useState<string | null>(null);

  // When a stage is selected, the canvas focuses its artifacts; otherwise show all.
  const selected = state.stages.find((s) => s.stageId === selectedStage);
  const visibleArtifacts = selected
    ? selected.artifactRefs.map((r) => state.artifacts[r]).filter(Boolean)
    : Object.values(state.artifacts);

  return (
    <div className="run">
      <Timeline
        stages={state.stages}
        selectedId={selectedStage}
        onSelect={(id) => setSelectedStage(id === selectedStage ? null : id)}
      />
      <Canvas artifacts={visibleArtifacts} />
      <AgentStream
        turns={state.turns}
        openGates={state.openGates}
        streaming={state.streaming}
        onSend={sendMessage}
        onResolveGate={resolveGate}
        onApproveGate={approveGate}
        onCancel={cancel}
      />
    </div>
  );
}

function RunViewInner() {
  const { state } = useRunContext();
  return (
    <div className="app">
      <Topbar state={state} />
      <RunZones />
    </div>
  );
}

export function RunView() {
  return (
    <RunProvider>
      <RunViewInner />
    </RunProvider>
  );
}
