import { MockRunPlayer } from "./player";
import type { DaemonMessage } from "../protocol";

const script: DaemonMessage[] = [
  { type: "run-started", runId: "r", goal: "g", stages: [] },
  { type: "gate-opened", runId: "r", gate: { id: "gate-A", kind: "clarify", prompt: "?" } },
  { type: "gate-closed", runId: "r", gateId: "gate-A" },
  { type: "run-finished", runId: "r", status: "completed" },
];

test("emits messages up to the first gate, then pauses until answered", () => {
  const seen: DaemonMessage[] = [];
  const player = new MockRunPlayer(script, { stepMs: 0 });
  player.subscribe((m) => seen.push(m));
  player.start();
  player.flush(); // drain synchronous (stepMs 0) emissions

  // Stops after emitting the gate-opened, before gate-closed.
  expect(seen.map((m) => m.type)).toEqual(["run-started", "gate-opened"]);
  expect(player.isWaitingForGate()).toBe(true);
});

test("answering the open gate resumes emission to completion", () => {
  const seen: DaemonMessage[] = [];
  const player = new MockRunPlayer(script, { stepMs: 0 });
  player.subscribe((m) => seen.push(m));
  player.start();
  player.flush();
  player.answerGate("gate-A");
  player.flush();

  expect(seen.map((m) => m.type)).toEqual([
    "run-started",
    "gate-opened",
    "gate-closed",
    "run-finished",
  ]);
  expect(player.isWaitingForGate()).toBe(false);
});
