/**
 * UAT — the auto-refresh storm fix (bug-bash P1). During a single agent turn the SQL console
 * used to re-run the tracked query + the N+1 /tables on EVERY tool-call tick (a summarize
 * turn fires several), contending with the agent on the one synchronized SQL connection. The
 * effect is now keyed on FINISHED-turn count, so a whole multi-tool-call turn triggers ONE
 * refresh at the boundary.
 *
 * This is verified deterministically: we fold the REAL captured transcript through the real
 * runState reducer and count how many DISTINCT values each keying scheme takes across the
 * stream. The number of effect runs == number of distinct successive key values. The new key
 * (finished-turn count) must change far fewer times than the old key (cumulative tool-calls).
 */
import { test, expect } from "vitest";
import { initialRunState, reduceRun, appendUserTurn, type RunState } from "../store/runState";
import { loadWsScript } from "./harness";

/** The OLD effect key: cumulative tool-call count across all turns. */
const oldKey = (s: RunState) => s.turns.reduce((acc, t) => acc + t.toolCalls.length, 0);
/** The NEW effect key: number of finished (non-streaming) agent turns. */
const newKey = (s: RunState) => s.turns.filter((t) => t.role === "agent" && t.status !== "streaming").length;

/** Count how many times a key's value CHANGES across the reduced stream (= effect runs). */
function effectRuns(key: (s: RunState) => number): number {
  let state = appendUserTurn(initialRunState, "Summarize the dataset");
  const script = loadWsScript().filter((m) => m.type !== "session-started");
  let prev = key(state);
  let runs = 0;
  for (const msg of script) {
    state = reduceRun(state, msg);
    const k = key(state);
    if (k !== prev) { runs++; prev = k; }
  }
  return runs;
}

test("the new turn-boundary key fires far fewer refreshes than the old per-tool-call key", () => {
  const oldRuns = effectRuns(oldKey);
  const newRuns = effectRuns(newKey);
  // The captured summarize turn makes several SQL tool-calls → the old key changed many times.
  expect(oldRuns).toBeGreaterThanOrEqual(5);
  // The new key changes once per finished turn — one turn here → exactly 1.
  expect(newRuns).toBe(1);
  expect(newRuns).toBeLessThan(oldRuns);
});
