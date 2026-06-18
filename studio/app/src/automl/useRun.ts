import { useEffect, useReducer, useRef, useState } from "react";
import { initialRunState, reduceRun, type RunState } from "../daemon/runState";
import { connectRun } from "../daemon/connect";
import type { RunConnection } from "../daemon/wsClient";

export interface RunController {
  state: RunState;
  /** Answer/dismiss the currently open gate, resuming the run. */
  resolveGate: (gateId: string) => void;
}

/**
 * Drives an AutoML Run into RunState. The source is chosen at connect time
 * (connectRun, ADR-0002): a real daemon WebSocket when the Tauri Shell reports one
 * attached, otherwise the in-process mock. The UI is identical for both.
 */
export function useRun(): RunController {
  const [state, dispatch] = useReducer(reduceRun, initialRunState);
  const connRef = useRef<RunConnection | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let disposed = false;
    // Demo/screenshot aid: ?auto resolves gates automatically so the full run plays.
    const auto = typeof window !== "undefined" && window.location.search.includes("auto");

    connectRun().then((conn) => {
      if (disposed) {
        conn.stop();
        return;
      }
      connRef.current = conn;
      unsub = conn.subscribe((msg) => {
        dispatch(msg);
        force((n) => n + 1);
        if (auto && msg.type === "gate-opened") {
          setTimeout(() => conn.answerGate(msg.gate.id), 200);
        }
      });
      // Start only after subscribing so the synchronous run-started isn't lost.
      conn.start();
    });

    return () => {
      disposed = true;
      unsub?.();
      connRef.current?.stop();
    };
  }, []);

  return {
    state,
    resolveGate: (gateId) => connRef.current?.answerGate(gateId),
  };
}
