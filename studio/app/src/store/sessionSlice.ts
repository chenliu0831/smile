/**
 * Session slice — the conversation/run state and its transitions.
 *
 * This is the agent-session half of the store (ADR-0006): turns, stages, artifacts, gates,
 * todos. It delegates every transition to the pure `reduceRun` reducer in
 * `daemon/runState.ts` (kept as the single source of transition logic — the review's
 * "deep, pure" exemplar), so this slice only owns *where* that state lives, not *how* it
 * changes.
 */
import type { StateCreator } from "zustand";
import {
  initialRunState,
  reduceRun,
  appendUserTurn as appendUserTurnReducer,
  type RunState,
} from "./runState";
import type { DaemonMessage } from "../daemon/protocol";
import type { RunStore } from "./runStore";

export interface SessionSlice {
  /** The conversation/run state (nested so its reference is stable across data-slice changes). */
  session: RunState;
  /** Apply a daemon message through the pure reducer. */
  applyMessage: (msg: DaemonMessage) => void;
  /** Append a user turn (a UI action, not a daemon message) and enter the streaming phase. */
  appendUserTurn: (text: string) => void;
  /** Wipe session state (turns/stages/artifacts) — e.g. when a new dataset is loaded. */
  resetSession: () => void;
}

export const createSessionSlice: StateCreator<RunStore, [], [], SessionSlice> = (set) => ({
  session: initialRunState,
  applyMessage: (msg) => set((s) => ({ session: reduceRun(s.session, msg) })),
  appendUserTurn: (text) => set((s) => ({ session: appendUserTurnReducer(s.session, text) })),
  resetSession: () => set({ session: initialRunState }),
});
