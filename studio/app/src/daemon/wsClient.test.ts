import { WebSocketRunConnection } from "./wsClient";
import type { DaemonMessage } from "./protocol";

/** Minimal fake WebSocket capturing sends and letting tests push inbound frames. */
class FakeWebSocket {
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  url: string;
  constructor(url: string) {
    this.url = url;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  receive(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  /** Simulate the daemon dropping the connection (crash / kill / expired token). */
  serverClose() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function setup(token?: string) {
  let fake!: FakeWebSocket;
  // @ts-expect-error swap global for the test
  globalThis.WebSocket = vi.fn((url: string) => (fake = new FakeWebSocket(url)));
  // @ts-expect-error attach OPEN constant the client reads
  globalThis.WebSocket.OPEN = 1;
  const conn = new WebSocketRunConnection("ws://127.0.0.1:8888/ws/run", token);
  return { get fake() { return fake; }, conn };
}

test("appends the session token as a query parameter", () => {
  const { fake } = setup("tok-abc");
  expect(fake.url).toBe("ws://127.0.0.1:8888/ws/run?token=tok-abc");
});

test("parses inbound JSON frames and delivers them as DaemonMessages", () => {
  const { fake, conn } = setup();
  const seen: DaemonMessage[] = [];
  conn.subscribe((m) => seen.push(m));
  fake.receive({ type: "session-started", sessionId: "s1" });
  fake.receive({ type: "agent-chunk", runId: "s1", text: "hi" });
  expect(seen.map((m) => m.type)).toEqual(["session-started", "agent-chunk"]);
});

test("sendMessage sends a user-message reply", () => {
  const { fake, conn } = setup();
  conn.sendMessage("analyze churn.csv");
  expect(JSON.parse(fake.sent.at(-1)!)).toEqual({ type: "user-message", text: "analyze churn.csv" });
});

test("answerGate sends a free-text answer reply", () => {
  const { fake, conn } = setup();
  conn.answerGate("g-metric", "AUC");
  expect(JSON.parse(fake.sent.at(-1)!)).toEqual({ type: "answer", gateId: "g-metric", answer: "AUC" });
});

test("buffers a message sent before the socket opens, then flushes on open", () => {
  const { fake, conn } = setup();
  fake.readyState = 0; // CONNECTING
  conn.sendMessage("queued");
  expect(fake.sent).toHaveLength(0);
  fake.readyState = 1; // OPEN
  fake.onopen?.();
  expect(JSON.parse(fake.sent.at(-1)!)).toEqual({ type: "user-message", text: "queued" });
});

test("ignores malformed inbound frames without throwing", () => {
  const { fake, conn } = setup();
  const seen: DaemonMessage[] = [];
  conn.subscribe((m) => seen.push(m));
  expect(() => fake.onmessage?.({ data: "not json{" })).not.toThrow();
  expect(seen).toHaveLength(0);
});

// Bug-bash P2: an idle-time daemon death (crash / kill / expired-token disconnect) used to
// close the socket silently — the next user message then buffered forever against a CLOSED
// socket. The close must now surface as a failed turn even with nothing queued.
test("an unexpected close (idle, nothing queued) surfaces a lost-connection failure", () => {
  const { fake, conn } = setup();
  const seen: DaemonMessage[] = [];
  conn.subscribe((m) => seen.push(m));
  fake.serverClose(); // daemon drops the connection while the user is idle
  expect(seen.map((m) => m.type)).toEqual(["agent-chunk", "run-finished"]);
  expect((seen[0] as { text: string }).text).toMatch(/lost/i);
  expect((seen[1] as { status: string }).status).toBe("failed");
});

test("a deliberate stop() close does NOT report a lost connection", () => {
  const { fake, conn } = setup();
  const seen: DaemonMessage[] = [];
  conn.subscribe((m) => seen.push(m));
  conn.stop();
  fake.onclose?.(); // close event fired by the deliberate stop
  expect(seen).toHaveLength(0);
});
