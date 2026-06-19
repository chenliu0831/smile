import type { Artifact, ChatTurn, DaemonMessage, Gate, StageProgress, Todo } from "./protocol";

/**
 * Session state for the interactive agent (ADR-0006). The conversation is an ordered
 * list of {@link ChatTurn}s (user / agent); stages, artifacts, and gates accumulate at
 * the session level as the agent works. `streaming` gates the chat input — the shared
 * Conversation drives one turn at a time, so input is disabled while a turn streams.
 */
export interface RunState {
  sessionId: string | null;
  /** Set when an AutoML run names a goal; otherwise the conversation is free-form. */
  goal: string;
  status: "idle" | "running" | "completed" | "failed" | "cancelled";
  /** True while an agent turn is in flight (input disabled). */
  streaming: boolean;
  turns: ChatTurn[];
  stages: StageProgress[];
  artifacts: Record<string, Artifact>;
  openGates: Gate[];
  /** The agent's current task plan (R1); full snapshot, replaced on each todo-list. */
  todos: Todo[];
}

export const initialRunState: RunState = {
  sessionId: null,
  goal: "",
  status: "idle",
  streaming: false,
  turns: [],
  stages: [],
  artifacts: {},
  openGates: [],
  todos: [],
};

let turnSeq = 0;
function nextTurnId(prefix: string): string {
  turnSeq += 1;
  return `${prefix}-${turnSeq}`;
}

/** Append `item` if its id is new, otherwise replace the existing entry in place. */
function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...list, item];
  const next = list.slice();
  next[idx] = item;
  return next;
}

/** Replace the last turn (immutably) via an updater. */
function updateLastTurn(turns: ChatTurn[], fn: (t: ChatTurn) => ChatTurn): ChatTurn[] {
  if (turns.length === 0) return turns;
  const next = turns.slice();
  next[next.length - 1] = fn(next[next.length - 1]);
  return next;
}

/** Ensure there is a streaming agent turn at the tail to attach output to. */
function ensureAgentTurn(state: RunState): RunState {
  const last = state.turns.at(-1);
  if (last && last.role === "agent" && last.status === "streaming") return state;
  const turn: ChatTurn = { id: nextTurnId("agent"), role: "agent", text: "", toolCalls: [], status: "streaming" };
  return { ...state, turns: [...state.turns, turn], streaming: true };
}

/** Append a user turn (UI action, not a daemon message) and enter the streaming phase. */
export function appendUserTurn(state: RunState, text: string): RunState {
  const turn: ChatTurn = { id: nextTurnId("user"), role: "user", text, toolCalls: [], status: "done" };
  return { ...state, turns: [...state.turns, turn], streaming: true };
}

export function reduceRun(state: RunState, msg: DaemonMessage): RunState {
  switch (msg.type) {
    case "session-started":
      // The greeting is owned by the cold-start welcome hero (ChatWelcome), NOT a
      // transcript turn — otherwise turns.length>0 would suppress the welcome (with its
      // starter chips + load CTA) the moment the session connects.
      return { ...state, sessionId: msg.sessionId, status: "running" };

    case "run-started":
      return { ...state, sessionId: msg.runId, goal: msg.goal, status: "running", stages: msg.stages };

    case "turn-started": {
      // Finalize any stranded streaming agent turn (e.g. two turn-started in a row)
      // before opening the new one, so empty "Thinking…" turns don't accumulate.
      const finalized = updateLastTurn(state.turns, (t) =>
        t.role === "agent" && t.status === "streaming" ? { ...t, status: "done" } : t,
      );
      const turn: ChatTurn = { id: msg.turnId, role: "agent", text: "", toolCalls: [], status: "streaming" };
      return { ...state, turns: [...finalized, turn], streaming: true };
    }

    case "turn-finished": {
      // Mark the matching turn done by id; only clear streaming if it was the one in flight.
      const idx = state.turns.findIndex((t) => t.id === msg.turnId);
      if (idx === -1) {
        // Unknown turn id — fall back to finalizing the tail streaming agent turn.
        const turns = updateLastTurn(state.turns, (t) =>
          t.role === "agent" && t.status === "streaming" ? { ...t, status: msg.status } : t,
        );
        return { ...state, turns, streaming: false };
      }
      const turns = state.turns.slice();
      const wasStreaming = turns[idx].status === "streaming";
      turns[idx] = { ...turns[idx], status: msg.status };
      return { ...state, turns, streaming: wasStreaming ? false : state.streaming };
    }

    case "agent-chunk": {
      const s = ensureAgentTurn(state);
      const turns = updateLastTurn(s.turns, (t) => ({ ...t, text: t.text + msg.text }));
      return { ...s, turns };
    }

    case "tool-call": {
      const s = ensureAgentTurn(state);
      const turns = updateLastTurn(s.turns, (t) => ({ ...t, toolCalls: upsertById(t.toolCalls, msg.call) }));
      return { ...s, turns };
    }

    case "stage-progress":
      return {
        ...state,
        stages: state.stages.some((x) => x.stageId === msg.stage.stageId)
          ? state.stages.map((x) => (x.stageId === msg.stage.stageId ? msg.stage : x))
          : [...state.stages, msg.stage],
      };

    case "todo-list":
      // Full snapshot each time — replace, don't merge.
      return { ...state, todos: msg.todos };

    case "artifact":
      return { ...state, artifacts: { ...state.artifacts, [msg.artifact.ref]: msg.artifact } };

    case "gate-opened":
      return { ...state, openGates: [...state.openGates, msg.gate] };

    case "gate-closed":
      return { ...state, openGates: state.openGates.filter((g) => g.id !== msg.gateId) };

    case "run-finished": {
      const turns = updateLastTurn(state.turns, (t) =>
        t.role === "agent" && t.status === "streaming" ? { ...t, status: "done" } : t,
      );
      return { ...state, status: msg.status, streaming: false, turns };
    }

    default:
      return state;
  }
}
