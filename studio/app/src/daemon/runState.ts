import type { Artifact, DaemonMessage, Gate, StageProgress, ToolCall } from "./protocol";

export interface RunState {
  runId: string | null;
  goal: string;
  status: "idle" | "running" | "completed" | "failed" | "cancelled";
  stages: StageProgress[];
  artifacts: Record<string, Artifact>;
  toolCalls: ToolCall[];
  agentText: string;
  openGates: Gate[];
}

export const initialRunState: RunState = {
  runId: null,
  goal: "",
  status: "idle",
  stages: [],
  artifacts: {},
  toolCalls: [],
  agentText: "",
  openGates: [],
};

/** Append `item` if its id is new, otherwise replace the existing entry in place. */
function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...list, item];
  const next = list.slice();
  next[idx] = item;
  return next;
}

export function reduceRun(state: RunState, msg: DaemonMessage): RunState {
  switch (msg.type) {
    case "run-started":
      return {
        ...state,
        runId: msg.runId,
        goal: msg.goal,
        status: "running",
        stages: msg.stages,
      };
    case "stage-progress":
      return {
        ...state,
        stages: state.stages.map((s) =>
          s.stageId === msg.stage.stageId ? msg.stage : s,
        ),
      };
    case "artifact":
      return {
        ...state,
        artifacts: { ...state.artifacts, [msg.artifact.ref]: msg.artifact },
      };
    case "tool-call":
      return { ...state, toolCalls: upsertById(state.toolCalls, msg.call) };
    case "agent-chunk":
      return { ...state, agentText: state.agentText + msg.text };
    case "gate-opened":
      return { ...state, openGates: [...state.openGates, msg.gate] };
    case "gate-closed":
      return {
        ...state,
        openGates: state.openGates.filter((g) => g.id !== msg.gateId),
      };
    case "run-finished":
      return { ...state, status: msg.status };
    default:
      return state;
  }
}
