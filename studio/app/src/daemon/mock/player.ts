/**
 * Streams a scripted DaemonMessage list to subscribers, mimicking the live daemon's
 * conversational WebSocket. Implements RunConnection: the session begins when the
 * first user message is sent; the script pauses at `gate-opened` until answered, so
 * the human-in-the-loop path is exercised end to end. A greeting (if provided) is
 * emitted immediately on start().
 */
import type { DaemonMessage } from "../protocol";

type Listener = (msg: DaemonMessage) => void;

export interface PlayerOptions {
  /** Delay between emissions in the live timer loop. `0` = drain via flush() in tests. */
  stepMs?: number;
  /** Emitted once on start() before any user turn. */
  greeting?: string;
}

export class MockRunPlayer {
  private readonly script: DaemonMessage[];
  private readonly stepMs: number;
  private readonly greeting?: string;
  private listeners: Listener[] = [];
  private cursor = 0;
  private waitingGate: string | null = null;
  private started = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(script: DaemonMessage[], opts: PlayerOptions = {}) {
    this.script = script;
    this.stepMs = opts.stepMs ?? 250;
    this.greeting = opts.greeting;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  /** Emit the greeting; the scripted run waits for the first user message. */
  start(): void {
    this.emit({ type: "session-started", sessionId: "mock", greeting: this.greeting });
  }

  /** A user turn starts (or, after the first, would continue) the scripted run. */
  sendMessage(_text: string): void {
    if (!this.started) {
      this.started = true;
      this.pump();
    }
  }

  isWaitingForGate(): boolean {
    return this.waitingGate !== null;
  }

  answerGate(gateId: string, _answer?: string): void {
    this.resume(gateId);
  }

  approveGate(gateId: string): void {
    this.resume(gateId);
  }

  cancel(): void {
    this.stop();
  }

  /** Synchronously drain all currently-emittable messages (tests, stepMs 0). */
  flush(): void {
    while (this.canEmit()) this.emitNext();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private resume(gateId: string): void {
    if (this.waitingGate === gateId) {
      this.waitingGate = null;
      this.pump();
    }
  }

  private emit(msg: DaemonMessage): void {
    for (const l of this.listeners) l(msg);
  }

  private canEmit(): boolean {
    return this.started && this.cursor < this.script.length && this.waitingGate === null;
  }

  private emitNext(): void {
    const msg = this.script[this.cursor++];
    this.emit(msg);
    if (msg.type === "gate-opened") this.waitingGate = msg.gate.id;
  }

  private pump(): void {
    if (!this.canEmit()) return;
    if (this.stepMs === 0) return; // tests drive via flush()
    this.emitNext();
    this.timer = setTimeout(() => this.pump(), this.stepMs);
  }
}
