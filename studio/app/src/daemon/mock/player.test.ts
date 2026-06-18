import { MockRunPlayer } from "./player";
import type { DaemonMessage } from "../protocol";

const script: DaemonMessage[] = [
  { type: "turn-started", turnId: "t1", role: "agent" },
  { type: "gate-opened", runId: "r", gate: { id: "gate-A", kind: "clarify", prompt: "?" } },
  { type: "gate-closed", runId: "r", gateId: "gate-A" },
  { type: "turn-finished", turnId: "t1", status: "done" },
];

test("start() emits a session-started greeting and waits for the first user message", () => {
  const seen: DaemonMessage[] = [];
  const player = new MockRunPlayer(script, { stepMs: 0, greeting: "Hi" });
  player.subscribe((m) => seen.push(m));
  player.start();
  player.flush();
  // Only the greeting so far — the script has not begun (no user message yet).
  expect(seen.map((m) => m.type)).toEqual(["session-started"]);
});

test("the first user message begins the scripted run, pausing at the gate", () => {
  const seen: DaemonMessage[] = [];
  const player = new MockRunPlayer(script, { stepMs: 0 });
  player.subscribe((m) => seen.push(m));
  player.start();
  player.sendMessage("analyze churn");
  player.flush();
  expect(seen.map((m) => m.type)).toEqual(["session-started", "turn-started", "gate-opened"]);
  expect(player.isWaitingForGate()).toBe(true);
});

test("answering the gate resumes to completion", () => {
  const seen: DaemonMessage[] = [];
  const player = new MockRunPlayer(script, { stepMs: 0 });
  player.subscribe((m) => seen.push(m));
  player.start();
  player.sendMessage("go");
  player.flush();
  player.answerGate("gate-A", "AUC");
  player.flush();
  expect(seen.map((m) => m.type)).toEqual([
    "session-started",
    "turn-started",
    "gate-opened",
    "gate-closed",
    "turn-finished",
  ]);
  expect(player.isWaitingForGate()).toBe(false);
});
