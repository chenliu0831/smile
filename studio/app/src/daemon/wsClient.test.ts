import { WebSocketRunConnection } from "./wsClient";
import type { DaemonMessage } from "./protocol";

/** Minimal fake WebSocket capturing sends and letting tests push inbound frames. */
class FakeWebSocket {
  static OPEN = 1;
  readyState = 1;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  receive(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

function setup() {
  const fake = new FakeWebSocket();
  // @ts-expect-error swap global for the test
  globalThis.WebSocket = vi.fn(() => fake);
  // @ts-expect-error attach OPEN constant the client reads
  globalThis.WebSocket.OPEN = 1;
  const conn = new WebSocketRunConnection("ws://127.0.0.1:8888/ws/run");
  return { fake, conn };
}

test("parses inbound JSON frames and delivers them as DaemonMessages", () => {
  const { fake, conn } = setup();
  const seen: DaemonMessage[] = [];
  conn.subscribe((m) => seen.push(m));

  fake.receive({ type: "run-started", runId: "r9", goal: "g", stages: [] });
  fake.receive({ type: "agent-chunk", runId: "r9", text: "hi" });

  expect(seen.map((m) => m.type)).toEqual(["run-started", "agent-chunk"]);
});

test("answerGate sends an approve reply carrying the streamed runId", () => {
  const { fake, conn } = setup();
  conn.subscribe(() => {});
  fake.receive({ type: "run-started", runId: "r9", goal: "g", stages: [] });

  conn.answerGate("g-metric");

  const reply = JSON.parse(fake.sent.at(-1)!);
  expect(reply).toEqual({ type: "approve", runId: "r9", gateId: "g-metric" });
});

test("ignores malformed inbound frames without throwing", () => {
  const { fake, conn } = setup();
  const seen: DaemonMessage[] = [];
  conn.subscribe((m) => seen.push(m));
  expect(() => fake.onmessage?.({ data: "not json{" })).not.toThrow();
  expect(seen).toHaveLength(0);
});
