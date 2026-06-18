import { gateFor } from "./gatePolicy";

const onStart = { approvalMode: "on-start" as const };
const perStep = { approvalMode: "per-step" as const };

test("routine stage actions are never gated (Auto tier)", () => {
  expect(gateFor({ kind: "routine", label: "Exploratory Data Analysis" }, onStart)).toBeNull();
  expect(gateFor({ kind: "routine", label: "Feature engineering" }, perStep)).toBeNull();
});

test("clarify actions always raise a Clarify gate, in either approval mode", () => {
  const action = {
    kind: "clarify" as const,
    label: "Confirm primary metric",
    question: { id: "q1", prompt: "What is the primary metric?", options: ["AUC", "F1"] },
  };
  expect(gateFor(action, onStart)?.kind).toBe("clarify");
  expect(gateFor(action, perStep)?.kind).toBe("clarify");
});

test("starting a run always raises an Approval gate (approve-on-start)", () => {
  const action = { kind: "start-run" as const, label: "Start AutoML Run" };
  expect(gateFor(action, onStart)?.kind).toBe("approval");
  expect(gateFor(action, perStep)?.kind).toBe("approval");
});

test("expensive actions flow on-start by default, but gate when per-step is opted in", () => {
  const action = { kind: "expensive" as const, label: "Run GPU NAS" };
  // Default: approve-on-start means expensive mid-run steps are NOT re-gated.
  expect(gateFor(action, onStart)).toBeNull();
  // Opt-in: the cautious user approves each expensive step.
  expect(gateFor(action, perStep)?.kind).toBe("approval");
});
