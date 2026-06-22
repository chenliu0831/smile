/**
 * Production-composition regression test for the connect/teardown race.
 *
 * main.tsx renders the app inside <React.StrictMode>, which in React 18 dev intentionally
 * double-invokes effects (mount → cleanup → mount) to surface unsafe effects. That double
 * mount is exactly what opened a SECOND daemon WebSocket and caused the daemon-side
 * FileSystemAlreadyExistsException. The store-level race test (store/connectionRace.test.ts)
 * pins the guard at the store layer with a hand-built sequence; THIS test reproduces the real
 * React composition — RunProvider → useRun's connect/teardown effect under StrictMode — so a
 * future regression in the EFFECT (cleanup, deps, or the one-store-per-mount ref) is caught
 * even if the store guard itself is intact. The rest of the suite renders WITHOUT StrictMode,
 * which is the gap that let the original bug ship.
 */
import { StrictMode } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RunProvider } from "../store/RunContext";
import type { RunConnection } from "../daemon/wsClient";
import type { RunConnectionResult } from "../daemon/connect";

/** Instrumented connection recording lifecycle calls, with shared counters across instances. */
function instrumentedFactory() {
  const stats = { created: 0, started: 0, stopped: 0, liveSubscribers: 0 };
  class C implements RunConnection {
    constructor() { stats.created++; }
    subscribe(): () => void {
      stats.liveSubscribers++;
      return () => { stats.liveSubscribers--; };
    }
    httpBase(): string | null { return null; }
    start(): void { stats.started++; }
    sendMessage(): void {}
    answerGate(): void {}
    approveGate(): void {}
    cancel(): void {}
    stop(): void { stats.stopped++; }
  }
  // connectRun-shaped: resolves on a microtask so the StrictMode mount→cleanup→mount can
  // interleave around the await (the real-world ordering).
  const connect = (async (): Promise<RunConnectionResult> => {
    await Promise.resolve();
    return { connection: new C(), mode: "daemon" };
  }) as unknown as typeof import("../daemon/connect").connectRun;
  return { connect, stats };
}

describe("connection lifecycle under React.StrictMode (production composition)", () => {
  it("settles with exactly one started connection and one live subscriber", async () => {
    const { connect, stats } = instrumentedFactory();

    render(
      <StrictMode>
        <RunProvider connect={connect}>
          <div>child</div>
        </RunProvider>
      </StrictMode>,
    );

    // Let all the StrictMode double-mount effects + the awaited connects settle.
    await waitFor(() => expect(stats.started).toBeGreaterThanOrEqual(1));
    // give any superseded in-flight connect a chance to resolve and be discarded
    await new Promise((r) => setTimeout(r, 20));

    // The crux: no matter how many connections StrictMode caused to be CREATED, exactly one
    // is wired up (started + subscribed); the rest were superseded and stopped.
    expect(stats.started).toBe(1);
    expect(stats.liveSubscribers).toBe(1);
    // Every created-but-superseded connection was stopped (created = started + stopped-extras;
    // the one live connection is not stopped, all others are).
    expect(stats.created - stats.stopped).toBe(1);
  });
});
