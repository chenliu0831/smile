/**
 * UAT — the load-bearing agent flow (connect → summarize → completion), replayed from the
 * REAL captured /ws/run transcript (ws-summarize.jsonl, 42 frames) through the REAL runState
 * reducer. This is the flow that must stay green: it proves the frontend correctly folds a
 * genuine daemon turn (session-started → tool-calls → agent-chunks → artifacts → finished).
 */
import { initialRunState, reduceRun, appendUserTurn, type RunState } from "../store/runState";
import type { DaemonMessage } from "../daemon/protocol";
import { fixtureConnect, loadWsScript } from "./harness";

/** Replay the fixture connection into RunState exactly as useRun's reducer would. */
async function replay(): Promise<RunState> {
  const connect = fixtureConnect();
  const { connection } = await connect(".");
  let state = initialRunState;
  connection.subscribe((msg: DaemonMessage) => {
    state = reduceRun(state, msg);
  });
  connection.start(); // emits session-started
  // user turn (what clicking "Summarize this dataset" sends)
  state = appendUserTurn(state, "Summarize the dataset: its shape, columns, and any data-quality issues.");
  connection.sendMessage("Summarize the dataset: its shape, columns, and any data-quality issues.");
  // MockRunPlayer(stepMs:0) needs a flush to drain synchronously
  (connection as unknown as { flush: () => void }).flush();
  return state;
}

test("the captured transcript has the expected real shape (42 frames, turn done)", () => {
  const script = loadWsScript();
  expect(script.length).toBe(42);
  expect(script[0].type).toBe("session-started");
  const finished = script.find((m) => m.type === "turn-finished");
  expect(finished).toMatchObject({ status: "done" });
});

test("replaying the summarize run folds into a completed session with agent output", async () => {
  const state = await replay();
  // a user turn + at least one agent turn
  const roles = state.turns.map((t) => t.role);
  expect(roles).toContain("user");
  expect(roles).toContain("agent");
  // the agent turn accumulated real summary PROSE — strip the bracketed tool-status echoes
  // ("[Executing SQL statement]", "[Describing table: titanic]") first so the assertion can't
  // pass on plumbing alone, and match a prose-only phrase (not the bare "titanic" that also
  // appears in a status echo).
  const agentText = state.turns
    .filter((t) => t.role === "agent")
    .map((t) => t.text)
    .join("")
    .replace(/\[[^\]]*\]/g, ""); // drop "[…]" status echoes
  expect(agentText.length).toBeGreaterThan(200);
  expect(agentText).toMatch(/Titanic Dataset Summary|891 rows|Missing/);
});

test("the agent's SQL tool-calls are captured in the run state", async () => {
  const state = await replay();
  const allToolCalls = state.turns.flatMap((t) => t.toolCalls ?? []);
  const sqlCalls = allToolCalls.filter((c) => c.kind === "sql");
  expect(sqlCalls.length).toBeGreaterThanOrEqual(4); // captured run made 5
  // includes the realistic self-corrected failure
  expect(allToolCalls.some((c) => c.status === "failed")).toBe(true);
});

test("the summarize run produces report artifacts and is not left streaming", async () => {
  const state = await replay();
  expect(Object.keys(state.artifacts).length).toBeGreaterThan(0);
  expect(state.streaming).toBe(false);
  // no gate left dangling
  expect(state.openGates).toHaveLength(0);
});
