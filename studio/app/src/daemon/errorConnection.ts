/**
 * A RunConnection that represents a FAILED daemon connection (ADR-0002). Used in the
 * desktop app when the analysis daemon can't start — instead of silently falling back to
 * the scripted demo (which would play fake results over the user's real data), this
 * surfaces the actual failure reason as a clean agent turn whenever the user sends a
 * message. It never fabricates analysis: no dataset, no churn script, just the error.
 */
import type { DaemonMessage } from "./protocol";
import type { RunConnection } from "./wsClient";

type Listener = (msg: DaemonMessage) => void;

export class ErrorRunConnection implements RunConnection {
  private listeners: Listener[] = [];

  constructor(private readonly reason: string) {}

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  /** No real daemon, so no HTTP base — the UI treats this as not-connected. */
  httpBase(): string | null {
    return null;
  }

  start(): void {
    this.emit({
      type: "session-started",
      sessionId: "unavailable",
      greeting:
        "The analysis daemon isn't connected, so I can't analyze data right now. " +
        "Check Settings (the LLM credential must be set in the app's environment), then relaunch.",
    });
  }

  /** Any user turn replies with the failure reason as a finished agent turn. */
  sendMessage(_text: string): void {
    const turnId = `err-${this.listeners.length}-${this.reason.length}`;
    this.emit({ type: "turn-started", turnId, role: "agent" });
    this.emit({ type: "agent-chunk", runId: turnId, text: this.reason });
    this.emit({ type: "turn-finished", turnId, status: "failed", outputTokens: 0 });
  }

  answerGate(): void {}
  approveGate(): void {}
  cancel(): void {}
  stop(): void {}

  private emit(msg: DaemonMessage): void {
    for (const l of this.listeners) l(msg);
  }
}
