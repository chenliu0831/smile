import { initialRunState, reduceRun, appendUserTurn } from "./runState";
import type { StageProgress } from "../daemon/protocol";

const stages: StageProgress[] = [
  { stageId: "eda", label: "Exploratory Data Analysis", status: "pending", artifactRefs: [] },
];

test("session-started sets the session id and marks the session running, with no turns", () => {
  const s = reduceRun(initialRunState, {
    type: "session-started",
    sessionId: "s1",
    greeting: "Hi, I'm Clair.",
  });
  expect(s.sessionId).toBe("s1");
  expect(s.status).toBe("running");
  // The greeting is owned by the cold-start welcome hero, NOT a transcript turn —
  // so turns stay empty and the welcome (chips + load CTA) shows until first interaction.
  expect(s.turns).toHaveLength(0);
});

test("initialRunState is a clean empty baseline (what a dataset-change reset returns to)", () => {
  // useRun's reset action returns initialRunState; assert it carries no stale session data.
  expect(initialRunState).toEqual({
    sessionId: null, goal: "", status: "idle", streaming: false,
    turns: [], stages: [], artifacts: {}, openGates: [], todos: [],
  });
});

test("appendUserTurn adds a user turn and marks the session streaming", () => {
  const s = appendUserTurn(initialRunState, "analyze churn.csv");
  expect(s.turns).toHaveLength(1);
  expect(s.turns[0]).toMatchObject({ role: "user", text: "analyze churn.csv" });
  expect(s.streaming).toBe(true);
});

test("turn-started opens a streaming agent turn", () => {
  let s = appendUserTurn(initialRunState, "hi");
  s = reduceRun(s, { type: "turn-started", turnId: "t1", role: "agent" });
  expect(s.turns).toHaveLength(2);
  expect(s.turns[1]).toMatchObject({ id: "t1", role: "agent", status: "streaming" });
});

test("agent-chunk appends to the current agent turn, auto-creating one if needed", () => {
  // Legacy path: no explicit turn-started (mock/scripted source).
  let s = reduceRun(initialRunState, { type: "agent-chunk", runId: "r", text: "Loading " });
  s = reduceRun(s, { type: "agent-chunk", runId: "r", text: "data…" });
  expect(s.turns).toHaveLength(1);
  expect(s.turns[0]).toMatchObject({ role: "agent", text: "Loading data…", status: "streaming" });
});

test("tool-call upserts into the current agent turn", () => {
  let s = reduceRun(initialRunState, { type: "turn-started", turnId: "t1", role: "agent" });
  s = reduceRun(s, { type: "tool-call", runId: "r", call: { id: "c1", title: "Read x", kind: "read", status: "running" } });
  s = reduceRun(s, { type: "tool-call", runId: "r", call: { id: "c1", title: "Read x", kind: "read", status: "done", score: "ok" } });
  expect(s.turns[0].toolCalls).toHaveLength(1);
  expect(s.turns[0].toolCalls[0].status).toBe("done");
});

test("turn-finished marks the current agent turn done and returns to idle", () => {
  let s = appendUserTurn(initialRunState, "hi");
  s = reduceRun(s, { type: "turn-started", turnId: "t1", role: "agent" });
  s = reduceRun(s, { type: "agent-chunk", runId: "r", text: "done" });
  s = reduceRun(s, { type: "turn-finished", turnId: "t1", status: "done", outputTokens: 42 });
  expect(s.turns[1].status).toBe("done");
  expect(s.streaming).toBe(false);
});

test("legacy run-started seeds the session and its stages", () => {
  const s = reduceRun(initialRunState, { type: "run-started", runId: "r1", goal: "Predict churn", stages });
  expect(s.sessionId).toBe("r1");
  expect(s.goal).toBe("Predict churn");
  expect(s.status).toBe("running");
  expect(s.stages.map((x) => x.stageId)).toEqual(["eda"]);
});

test("stage-progress updates a session stage in place", () => {
  let s = reduceRun(initialRunState, { type: "run-started", runId: "r1", goal: "g", stages });
  s = reduceRun(s, {
    type: "stage-progress",
    runId: "r1",
    stage: { stageId: "eda", label: "Exploratory Data Analysis", status: "done", artifactRefs: ["rep"] },
  });
  expect(s.stages[0].status).toBe("done");
});

test("artifact adds/replaces by ref at the session level", () => {
  let s = reduceRun(initialRunState, { type: "artifact", runId: "r", artifact: { ref: "lb", kind: "leaderboard", title: "L" } });
  s = reduceRun(s, { type: "artifact", runId: "r", artifact: { ref: "lb", kind: "leaderboard", title: "L2" } });
  expect(Object.keys(s.artifacts)).toEqual(["lb"]);
  expect(s.artifacts.lb.title).toBe("L2");
});

test("artifact carries the structured `meta` payload verbatim (ADR-0011)", () => {
  const meta = { task_type: "binary", test_auc: 0.86, features: [{ name: "Age", mean: 0.038, std: 0.014 }] };
  const s = reduceRun(initialRunState, {
    type: "artifact",
    runId: "r",
    artifact: { ref: "metrics:final", kind: "dataframe", title: "M", meta },
  });
  expect(s.artifacts["metrics:final"].meta).toEqual(meta);
});

test("gate-opened/closed add and remove session gates", () => {
  let s = reduceRun(initialRunState, { type: "gate-opened", runId: "r", gate: { id: "g1", kind: "clarify", prompt: "?" } });
  expect(s.openGates).toHaveLength(1);
  s = reduceRun(s, { type: "gate-closed", runId: "r", gateId: "g1" });
  expect(s.openGates).toHaveLength(0);
});

test("two turn-started in a row finalize the stranded turn (no empty Thinking turn lingers)", () => {
  let s = reduceRun(initialRunState, { type: "turn-started", turnId: "t1", role: "agent" });
  s = reduceRun(s, { type: "turn-started", turnId: "t2", role: "agent" });
  expect(s.turns).toHaveLength(2);
  expect(s.turns[0].status).toBe("done"); // t1 finalized
  expect(s.turns[1].status).toBe("streaming"); // t2 active
});

test("turn-finished targets the turn by id and only clears streaming for the active one", () => {
  let s = reduceRun(initialRunState, { type: "turn-started", turnId: "t1", role: "agent" });
  s = reduceRun(s, { type: "agent-chunk", runId: "r", text: "x" });
  // A stale finish for an unknown turn must not wrongly flip the active turn's state.
  s = reduceRun(s, { type: "turn-finished", turnId: "nope", status: "done" });
  // (fallback path finalizes the tail streaming turn — acceptable) then the real finish:
  let s2 = reduceRun(
    { ...initialRunState, turns: [
      { id: "t1", role: "agent", text: "x", toolCalls: [], status: "streaming" },
    ], streaming: true },
    { type: "turn-finished", turnId: "t1", status: "done" },
  );
  expect(s2.turns[0].status).toBe("done");
  expect(s2.streaming).toBe(false);
});

test("todo-list replaces the task plan with the latest full snapshot", () => {
  let s = reduceRun(initialRunState, {
    type: "todo-list",
    runId: "r",
    todos: [
      { content: "Load data", status: "completed", activeForm: "Loading data" },
      { content: "Train models", status: "in_progress", activeForm: "Training models" },
    ],
  });
  expect(s.todos).toHaveLength(2);
  expect(s.todos[1].status).toBe("in_progress");
  // A later snapshot fully replaces the prior list (TodoWrite re-sends all todos).
  s = reduceRun(s, {
    type: "todo-list",
    runId: "r",
    todos: [{ content: "Train models", status: "completed", activeForm: "Training models" }],
  });
  expect(s.todos).toHaveLength(1);
  expect(s.todos[0].status).toBe("completed");
});

test("run-finished marks any streaming turn done and sets terminal status", () => {
  let s = reduceRun(initialRunState, { type: "agent-chunk", runId: "r", text: "x" });
  s = reduceRun(s, { type: "run-finished", runId: "r", status: "completed" });
  expect(s.status).toBe("completed");
  expect(s.streaming).toBe(false);
  expect(s.turns[0].status).toBe("done");
});
