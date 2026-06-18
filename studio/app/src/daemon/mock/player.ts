/**
 * Streams a scripted DaemonMessage list to subscribers, mimicking the live daemon
 * WebSocket. Pauses when it emits a `gate-opened` until the gate is answered, so the
 * UI's human-in-the-loop path is exercised end to end.
 */
import type { DaemonMessage } from "../protocol";

type Listener = (msg: DaemonMessage) => void;

export interface PlayerOptions {
  /** Delay between emissions in the live timer loop. `0` = drain via flush() in tests. */
  stepMs?: number;
}

export class MockRunPlayer {
  private readonly script: DaemonMessage[];
  private readonly stepMs: number;
  private listeners: Listener[] = [];
  private cursor = 0;
  private waitingGate: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(script: DaemonMessage[], opts: PlayerOptions = {}) {
    this.script = script;
    this.stepMs = opts.stepMs ?? 250;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  start(): void {
    this.pump();
  }

  isWaitingForGate(): boolean {
    return this.waitingGate !== null;
  }

  /** Resolve the open gate and continue. */
  answerGate(gateId: string): void {
    if (this.waitingGate === gateId) {
      this.waitingGate = null;
      this.pump();
    }
  }

  /** Synchronously drain all currently-emittable messages (used in tests, stepMs 0). */
  flush(): void {
    while (this.canEmit()) {
      this.emitNext();
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private canEmit(): boolean {
    return this.cursor < this.script.length && this.waitingGate === null;
  }

  private emitNext(): void {
    const msg = this.script[this.cursor++];
    for (const l of this.listeners) l(msg);
    if (msg.type === "gate-opened") {
      this.waitingGate = msg.gate.id;
    }
  }

  private pump(): void {
    if (!this.canEmit()) return;
    if (this.stepMs === 0) {
      // Caller drives via flush().
      return;
    }
    this.emitNext();
    this.timer = setTimeout(() => this.pump(), this.stepMs);
  }
}
