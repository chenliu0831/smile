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
import { httpBaseFromWs } from "./datasetInfo";

type Listener = (msg: DaemonMessage) => void;

export interface RunConnection {
  subscribe(fn: Listener): () => void;
  /** Daemon HTTP base (e.g. http://127.0.0.1:PORT/api/v1), or null for the mock. */
  httpBase(): string | null;
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
  /** Set by stop() so a deliberate teardown isn't reported as a lost connection. */
  private closing = false;

  private readonly base: string;

  constructor(url: string, token?: string) {
    this.base = httpBaseFromWs(url);
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
      // A deliberate stop() (unmount / reconnect) is expected — stay quiet. ANY other close
      // means the daemon died (crash, killed, expired-token disconnect). Previously this only
      // surfaced if a message was still queued, so an idle-time death went unnoticed and the
      // NEXT user message buffered forever against a CLOSED socket. Always surface it.
      if (!this.closing) this.fail("Connection to the daemon was lost.");
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

  httpBase(): string | null {
    return this.base;
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
    this.closing = true; // mark deliberate so onclose doesn't report a lost connection
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
