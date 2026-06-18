/**
 * WebSocket client to the real Smile Daemon (ADR-0002). Connects to the daemon's
 * loopback WebSocket, parses inbound JSON frames as DaemonMessages, and sends
 * WebviewReply frames (user messages, gate answers, cancel). Mirrors the
 * MockRunPlayer surface so useRun can treat them interchangeably.
 *
 * If a session token is provided it is appended as a `?token=` query parameter
 * (the daemon verifies it on connect, ADR-0002).
 */
import type { DaemonMessage } from "./protocol";

type Listener = (msg: DaemonMessage) => void;

export interface RunConnection {
  subscribe(fn: Listener): () => void;
  /** Open the session. Called AFTER subscribe so no early message is missed. */
  start(): void;
  /** Send a free-text user turn (starts or continues the conversation). */
  sendMessage(text: string): void;
  /** Answer an open clarify gate with free text (or a chosen option). */
  answerGate(gateId: string, answer?: string): void;
  /** Approve a non-clarify gate. */
  approveGate(gateId: string): void;
  /** Cancel the in-flight turn. */
  cancel(): void;
  stop(): void;
}

export class WebSocketRunConnection implements RunConnection {
  private ws: WebSocket;
  private listeners: Listener[] = [];
  /** Messages queued before the socket is OPEN, flushed on open in order. */
  private queue: unknown[] = [];
  private failed = false;

  constructor(url: string, token?: string) {
    const full = token ? `${url}?token=${encodeURIComponent(token)}` : url;
    this.ws = new WebSocket(full);
    this.ws.onopen = () => {
      const pending = this.queue;
      this.queue = [];
      for (const m of pending) this.rawSend(m);
    };
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as DaemonMessage;
        for (const l of this.listeners) l(msg);
      } catch {
        // Ignore malformed frames.
      }
    };
    this.ws.onerror = () => this.fail("Connection to the daemon failed.");
    this.ws.onclose = () => {
      // Anything still queued (never sent) is lost; surface it rather than buffer forever.
      if (this.queue.length > 0) this.fail("Connection closed before messages were sent.");
    };
  }

  /** Notify listeners the session ended abnormally and drop any unsent queue. */
  private fail(reason: string): void {
    if (this.failed) return;
    this.failed = true;
    this.queue = [];
    for (const l of this.listeners) {
      l({ type: "agent-chunk", runId: "", text: `\n[${reason}]\n` });
      l({ type: "run-finished", runId: "", status: "failed" });
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  /** No-op: the conversation begins when the first user message is sent. */
  start(): void {}

  sendMessage(text: string): void {
    this.send({ type: "user-message", text });
  }

  answerGate(gateId: string, answer = ""): void {
    this.send({ type: "answer", gateId, answer });
  }

  approveGate(gateId: string): void {
    this.send({ type: "approve", gateId });
  }

  cancel(): void {
    this.send({ type: "cancel-run" });
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
      this.rawSend(obj);
    } else {
      // Buffer until open (e.g. the first user message sent right after construction).
      this.queue.push(obj);
    }
  }

  private rawSend(obj: unknown): void {
    this.ws.send(JSON.stringify(obj));
  }
}
