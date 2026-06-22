/**
 * Regression test for the connect/teardown race (the C1 Zustand-migration regression that
 * surfaced as a daemon-side `FileSystemAlreadyExistsException`).
 *
 * The old pre-Zustand `useRun` guarded an in-flight connect against an effect-cleanup with a
 * `disposed` flag; the Zustand `connectionSlice` initially dropped that guard. Under React
 * StrictMode's dev mount→cleanup→mount, `connect#1` is still awaiting `connectRun` when
 * `teardown()` runs (so `connection` is still null — nothing to stop), then `connect#1`
 * resolves and starts/stores an orphaned WebSocket while the remount's `connect#2` opens a
 * second one. Two live `/ws/run` connections → two daemon agent sessions → the race in
 * smile.io.Paths.
 *
 * The fix is an epoch token: a connect superseded while awaiting stops its just-created
 * connection instead of wiring it up. These tests pin that behavior at the store layer
 * (the existing UATs render without StrictMode and connect exactly once, so they can't catch
 * it).
 */
import { describe, it, expect } from "vitest";
import { createRunStore } from "./runStore";
import type { RunConnection } from "../daemon/wsClient";
import type { RunConnectionResult } from "../daemon/connect";

/** A RunConnection that records lifecycle calls so we can assert what got wired vs stopped. */
class FakeConnection implements RunConnection {
  started = false;
  stopped = false;
  listeners = 0;
  constructor(readonly id: number) {}
  subscribe(): () => void {
    this.listeners++;
    return () => { this.listeners--; };
  }
  httpBase(): string | null { return null; }
  start(): void { this.started = true; }
  sendMessage(): void {}
  answerGate(): void {}
  approveGate(): void {}
  cancel(): void {}
  stop(): void { this.stopped = true; }
}

/**
 * A `connectRun`-shaped factory whose promises are resolved MANUALLY, so a test can hold a
 * connect mid-flight and interleave teardown/reconnect before letting it resolve.
 */
function deferredConnectFactory() {
  const conns: FakeConnection[] = [];
  const resolvers: Array<() => void> = [];
  let n = 0;
  const connectRun = (() =>
    new Promise<RunConnectionResult>((resolve) => {
      const conn = new FakeConnection(++n);
      conns.push(conn);
      resolvers.push(() => resolve({ connection: conn, mode: "daemon" }));
    })) as unknown as typeof import("../daemon/connect").connectRun;
  return {
    connectRun,
    conns,
    /** Resolve the i-th (0-based) in-flight connectRun call. */
    resolve: (i: number) => resolvers[i](),
  };
}

describe("connect/teardown race (StrictMode double-mount)", () => {
  it("a connect superseded by teardown stops its connection and never wires it up", async () => {
    const f = deferredConnectFactory();
    const store = createRunStore(f.connectRun);

    // Mount #1: connect#1 begins (opens FakeConnection #1) but does NOT resolve yet.
    const p1 = store.getState().connect();
    // StrictMode cleanup before connect#1 resolved.
    store.getState().teardown();
    // Now connect#1 resolves — must be discarded (stopped), not started/stored.
    f.resolve(0);
    await p1;

    expect(f.conns[0].stopped).toBe(true);
    expect(f.conns[0].started).toBe(false);
    expect(f.conns[0].listeners).toBe(0); // never subscribed → no orphaned frame pump
    expect(store.getState().connection).toBeNull();
  });

  it("only the latest connection is wired when mount#2 races mount#1 (the actual bug)", async () => {
    const f = deferredConnectFactory();
    const store = createRunStore(f.connectRun);

    // Mount #1 → connect#1 (FakeConnection #1), in-flight.
    const p1 = store.getState().connect();
    // StrictMode: cleanup, then mount #2 → connect#2 (FakeConnection #2), also in-flight.
    store.getState().teardown();
    const p2 = store.getState().connect();

    // Resolve in arrival order: connect#1 first (the stale one), then connect#2.
    f.resolve(0);
    f.resolve(1);
    await Promise.all([p1, p2]);

    // connect#1 discarded; connect#2 is the live one.
    expect(f.conns[0].stopped).toBe(true);
    expect(f.conns[0].started).toBe(false);
    expect(f.conns[1].started).toBe(true);
    expect(f.conns[1].stopped).toBe(false);
    expect(store.getState().connection).toBe(f.conns[1]);
    // Exactly one connection is subscribed → frames aren't double-applied to the reducer.
    expect(f.conns[0].listeners + f.conns[1].listeners).toBe(1);
  });

  it("a normal single connect (no teardown) wires up exactly one connection", async () => {
    const f = deferredConnectFactory();
    const store = createRunStore(f.connectRun);
    const p = store.getState().connect();
    f.resolve(0);
    await p;
    expect(f.conns[0].started).toBe(true);
    expect(f.conns[0].stopped).toBe(false);
    expect(store.getState().connection).toBe(f.conns[0]);
  });
});
