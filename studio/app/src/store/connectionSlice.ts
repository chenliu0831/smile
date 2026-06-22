/**
 * Connection slice — the live daemon connection and its lifecycle.
 *
 * Owns the single `RunConnection` (real WebSocket, mock player, or error connection), the
 * derived `httpBase`, the `ConnectionMode`, and the connect/reconnect/teardown actions. It
 * subscribes the connection's frames into the session slice's `applyMessage`. The connection
 * FACTORY is injected (defaults to the real `connectRun`) — this is the seam the replay
 * harness uses, preserved verbatim from the old `useRun(connect)` surface.
 */
import type { StateCreator } from "zustand";
import { connectRun as defaultConnectRun, type ConnectionMode } from "../daemon/connect";
import type { RunConnection } from "../daemon/wsClient";
import type { RunStore } from "./runStore";

export interface ConnectionSlice {
  /** The live connection, or null before first connect / after teardown. */
  connection: RunConnection | null;
  /** Daemon HTTP base (…/api/v1) when a real daemon is attached, else null. */
  httpBase: string | null;
  /** How the session is connected: real daemon, browser demo, or failed daemon. */
  mode: ConnectionMode;
  /** Open (or reopen) the connection against `workingDir`, wiring frames into the session. */
  connect: (workingDir?: string) => Promise<void>;
  /** Tear down the live connection (unmount / before reconnect). */
  teardown: () => void;
  /**
   * The current connection-lifecycle token. Any async action that resolves and then writes
   * connection-scoped state (e.g. dataset insights) should capture this before its await and
   * bail if it changed — the same supersession guard `connect()` uses, so a stale daemon's
   * late result can't land on a newer session. Bumped by every connect() and teardown().
   */
  lifecycle: () => number;
  /** Send a free-text user turn (guarded: one turn at a time). */
  sendMessage: (text: string) => void;
  /** Answer an open clarify gate with free text (or a chosen option). */
  resolveGate: (gateId: string, answer?: string) => void;
  /** Approve a non-clarify (approval) gate. */
  approveGate: (gateId: string) => void;
  /** Interrupt the in-flight turn. */
  cancel: () => void;
}

/**
 * @param connectRun the connection factory (injected; defaults to the real one). The replay
 *   harness passes a fixture-backed factory so the whole store drives captured frames.
 */
export const createConnectionSlice =
  (connectRun: typeof defaultConnectRun): StateCreator<RunStore, [], [], ConnectionSlice> =>
  (set, get) => {
    // Monotonic lifecycle token, held in the slice closure (NOT reactive state — it must not
    // re-render). Bumped by every connect() and teardown(). A connect() captures the token
    // before awaiting connectRun; if it changed by the time the connection resolves, this
    // connect was superseded (a teardown or a newer connect ran meanwhile) — we stop the
    // just-created connection and bail instead of starting/storing it. This restores the
    // disposed-guard the pre-Zustand useRun had: without it, a React StrictMode double-mount
    // (or a fast reconnect) leaves connect#1 AND connect#2 both stored — connect#2 overwrites
    // `connection`, orphaning connect#1's socket with its subscription still pushing frames
    // into the reducer (duplicate frames + a leaked WS + a second daemon agent session).
    let epoch = 0;
    return {
      connection: null,
      httpBase: null,
      mode: "demo",

      lifecycle: () => epoch,

      connect: async (workingDir = ".") => {
        const myEpoch = ++epoch;
        const { connection: conn, mode } = await connectRun(350, workingDir);
        if (myEpoch !== epoch) {
          // Superseded while awaiting — discard this connection rather than wiring it up.
          conn.stop();
          return;
        }
        // Subscribe BEFORE start() so no early frame (the greeting) is missed.
        conn.subscribe((msg) => get().applyMessage(msg));
        conn.start();
        const base = conn.httpBase();
        set({ connection: conn, mode, httpBase: base });
        // If a real daemon is attached, fetch native dataset insights (data slice owns it).
        if (base) get().refreshDatasetInfo(base);
        else get().setDatasetInfo(null);
      },

      teardown: () => {
        epoch++; // invalidate any in-flight connect() so it won't start/store its connection
        get().connection?.stop();
        set({ connection: null });
      },

      sendMessage: (text) => {
        const s = get();
        // One turn at a time: the daemon's Conversation is shared mutable state, so refuse to
        // send while a turn streams or a gate is open (the UI also disables the input).
        if (s.session.streaming || s.session.openGates.length > 0) return;
        s.appendUserTurn(text);
        s.connection?.sendMessage(text);
      },

      resolveGate: (gateId, answer) => get().connection?.answerGate(gateId, answer),
      approveGate: (gateId) => get().connection?.approveGate(gateId),
      cancel: () => get().connection?.cancel(),
    };
  };
