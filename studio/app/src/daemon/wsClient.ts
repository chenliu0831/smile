/**
 * WebSocket client to the real Smile Daemon (ADR-0002). Connects directly to the
 * daemon's loopback WebSocket, parses inbound JSON frames as DaemonMessages, and
 * sends WebviewReply frames (gate answers / cancel). Mirrors the MockRunPlayer
 * surface (subscribe / answerGate / stop) so useRun can treat them interchangeably.
 */
import type { DaemonMessage } from "./protocol";

type Listener = (msg: DaemonMessage) => void;

export interface RunConnection {
  subscribe(fn: Listener): () => void;
  /** Begin streaming. Called AFTER subscribe so no early message is missed. */
  start(): void;
  /** Resolve an open gate (approve / answer), resuming the run. */
  answerGate(gateId: string): void;
  stop(): void;
}

export class WebSocketRunConnection implements RunConnection {
  private ws: WebSocket;
  private listeners: Listener[] = [];
  private runId = "";

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as DaemonMessage;
        if ("runId" in msg && typeof msg.runId === "string") this.runId = msg.runId;
        for (const l of this.listeners) l(msg);
      } catch {
        // Ignore malformed frames.
      }
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  /** No-op: the daemon starts the run when the socket opens (OnOpen). */
  start(): void {}

  answerGate(gateId: string): void {
    this.send({ type: "approve", runId: this.runId, gateId });
  }

  cancel(): void {
    this.send({ type: "cancel-run", runId: this.runId });
  }

  stop(): void {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }

  private send(obj: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }
}
