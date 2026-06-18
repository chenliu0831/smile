import { initialRunState, reduceRun } from "./runState";
import type { DaemonMessage, StageProgress } from "./protocol";

const stages: StageProgress[] = [
  { stageId: "eda", label: "Exploratory Data Analysis", status: "pending", artifactRefs: [] },
  { stageId: "preprocess", label: "Preprocessing", status: "pending", artifactRefs: [] },
];

const started: DaemonMessage = {
  type: "run-started",
  runId: "r1",
  goal: "Predict churn",
  stages,
};

test("run-started seeds the run id, goal, ordered stages and running status", () => {
  const state = reduceRun(initialRunState, started);
  expect(state.runId).toBe("r1");
  expect(state.goal).toBe("Predict churn");
  expect(state.status).toBe("running");
  expect(state.stages.map((s) => s.stageId)).toEqual(["eda", "preprocess"]);
});

test("stage-progress updates the matching stage in place, preserving order", () => {
  const state = reduceRun(initialRunState, started);
  const next = reduceRun(state, {
    type: "stage-progress",
    runId: "r1",
    stage: {
      stageId: "eda",
      label: "Exploratory Data Analysis",
      status: "done",
      artifactRefs: ["eda_report"],
      detail: "12 features profiled",
    },
  });
  expect(next.stages.map((s) => s.stageId)).toEqual(["eda", "preprocess"]);
  expect(next.stages[0].status).toBe("done");
  expect(next.stages[0].detail).toBe("12 features profiled");
  expect(next.stages[1].status).toBe("pending");
});

test("artifact adds by ref, then replaces the same ref on update", () => {
  let state = reduceRun(initialRunState, started);
  state = reduceRun(state, {
    type: "artifact",
    runId: "r1",
    artifact: { ref: "lb", kind: "leaderboard", title: "Leaderboard" },
  });
  expect(state.artifacts.lb.title).toBe("Leaderboard");

  state = reduceRun(state, {
    type: "artifact",
    runId: "r1",
    artifact: { ref: "lb", kind: "leaderboard", title: "Leaderboard (final)" },
  });
  expect(Object.keys(state.artifacts)).toEqual(["lb"]);
  expect(state.artifacts.lb.title).toBe("Leaderboard (final)");
});

test("tool-call appends, then updates the same id in place on status change", () => {
  let state = reduceRun(initialRunState, started);
  state = reduceRun(state, {
    type: "tool-call",
    runId: "r1",
    call: { id: "t1", title: "Ran candidate_lgbm.py", kind: "script", status: "running" },
  });
  state = reduceRun(state, {
    type: "tool-call",
    runId: "r1",
    call: { id: "t2", title: "Ran candidate_rf.py", kind: "script", status: "running" },
  });
  expect(state.toolCalls.map((c) => c.id)).toEqual(["t1", "t2"]);

  state = reduceRun(state, {
    type: "tool-call",
    runId: "r1",
    call: { id: "t1", title: "Ran candidate_lgbm.py", kind: "script", status: "done", score: "AUC 0.91" },
  });
  expect(state.toolCalls.map((c) => c.id)).toEqual(["t1", "t2"]);
  expect(state.toolCalls[0].status).toBe("done");
  expect(state.toolCalls[0].score).toBe("AUC 0.91");
});

test("agent-chunk accumulates into the agent text stream", () => {
  let state = reduceRun(initialRunState, started);
  state = reduceRun(state, { type: "agent-chunk", runId: "r1", text: "Loading " });
  state = reduceRun(state, { type: "agent-chunk", runId: "r1", text: "churn.csv…" });
  expect(state.agentText).toBe("Loading churn.csv…");
});

test("gate-opened adds an open gate; gate-closed removes it by id", () => {
  let state = reduceRun(initialRunState, started);
  state = reduceRun(state, {
    type: "gate-opened",
    runId: "r1",
    gate: { id: "g1", kind: "clarify", prompt: "What is the primary metric?" },
  });
  state = reduceRun(state, {
    type: "gate-opened",
    runId: "r1",
    gate: { id: "g2", kind: "approval", prompt: "Run GPU NAS?" },
  });
  expect(state.openGates.map((g) => g.id)).toEqual(["g1", "g2"]);

  state = reduceRun(state, { type: "gate-closed", runId: "r1", gateId: "g1" });
  expect(state.openGates.map((g) => g.id)).toEqual(["g2"]);
});

test("run-finished sets the terminal status", () => {
  let state = reduceRun(initialRunState, started);
  state = reduceRun(state, { type: "run-finished", runId: "r1", status: "completed" });
  expect(state.status).toBe("completed");
});
