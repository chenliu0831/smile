/**
 * The AutoML Run view (ADR-0006): three coordinated zones — pipeline timeline,
 * artifact canvas, agent stream — driven by a single RunState. Progressive
 * disclosure: calm by default, every layer one click away.
 */
import { useState } from "react";
import { useRun } from "../automl/useRun";
import { Timeline } from "./Timeline";
import { Canvas } from "./Canvas";
import { AgentStream } from "./AgentStream";

export function RunView() {
  const { state, resolveGate } = useRun();
  const [selectedStage, setSelectedStage] = useState<string | null>(null);

  // When a stage is selected, the canvas focuses its artifacts; otherwise show all.
  const selected = state.stages.find((s) => s.stageId === selectedStage);
  const visibleArtifacts = selected
    ? selected.artifactRefs.map((r) => state.artifacts[r]).filter(Boolean)
    : Object.values(state.artifacts);

  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">Smile<span className="dot">.</span>Studio</span>
        <span className="goal">{state.goal || "AutoML"}</span>
        <span className="spacer" />
        <span className={`status-pill ${state.status}`}>
          {state.status === "running" ? "Running" : state.status === "completed" ? "Completed" : state.status}
        </span>
      </div>
      <div className="run">
        <Timeline stages={state.stages} selectedId={selectedStage} onSelect={(id) =>
          setSelectedStage(id === selectedStage ? null : id)} />
        <Canvas artifacts={visibleArtifacts} />
        <AgentStream
          agentText={state.agentText}
          toolCalls={state.toolCalls}
          openGates={state.openGates}
          onResolveGate={resolveGate}
        />
      </div>
    </div>
  );
}
