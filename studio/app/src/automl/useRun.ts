import { useEffect, useReducer, useRef, useState } from "react";
import { initialRunState, reduceRun, appendUserTurn, type RunState } from "../daemon/runState";
import { connectRun } from "../daemon/connect";
import type { RunConnection } from "../daemon/wsClient";
import type { DaemonMessage } from "../daemon/protocol";

export interface RunController {
  state: RunState;
  /** Send a free-text user turn (start or continue the conversation). */
  sendMessage: (text: string) => void;
  /** Answer the open clarify gate with free text (or a chosen option). */
  resolveGate: (gateId: string, answer?: string) => void;
  /** Approve a non-clarify (approval) gate. */
  approveGate: (gateId: string) => void;
  /** Interrupt the in-flight turn. */
  cancel: () => void;
  /** Restart the session against a new working directory (e.g. after loading a dataset). */
  reconnect: (workingDir?: string) => void;
}

/** Local action: a user turn the UI appends optimistically (not a daemon message). */
type LocalAction = { __local: "user-turn"; text: string };

function rootReducer(state: RunState, action: DaemonMessage | LocalAction): RunState {
  if ("__local" in action) {
    return appendUserTurn(state, action.text);
  }
  return reduceRun(state, action);
}

/**
 * Drives the interactive agent session into RunState. The source is chosen at connect
 * time (connectRun, ADR-0002): a real daemon WebSocket when the Tauri Shell reports one
 * attached, otherwise the in-process mock. The UI is identical for both.
 */
export function useRun(): RunController {
  const [state, dispatch] = useReducer(rootReducer, initialRunState);
  const connRef = useRef<RunConnection | null>(null);
  const [, force] = useState(0);
  const [generation, setGeneration] = useState(0);
  const workingDirRef = useRef<string>(".");

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let disposed = false;
    // Demo/screenshot aid: ?auto sends an opening message + auto-answers gates.
    const auto = typeof window !== "undefined" && window.location.search.includes("auto");

    connectRun(350, workingDirRef.current).then((conn) => {
      if (disposed) {
        conn.stop();
        return;
      }
      connRef.current = conn;
      unsub = conn.subscribe((msg) => {
        dispatch(msg);
        force((n) => n + 1);
        if (auto && msg.type === "gate-opened") {
          setTimeout(() => conn.answerGate(msg.gate.id, "AUC"), 200);
        }
      });
      conn.start();
      if (auto) {
        // Kick off the scripted conversation without a human typing.
        setTimeout(() => {
          dispatch({ __local: "user-turn", text: "Analyze the dataset and build the best model." });
          conn.sendMessage("Analyze the dataset and build the best model.");
        }, 150);
      }
    });

    return () => {
      disposed = true;
      unsub?.();
      connRef.current?.stop();
    };
  }, [generation]);

  return {
    state,
    sendMessage: (text) => {
      // One turn at a time: the daemon's Conversation is shared mutable state, so refuse
      // to send while a turn is streaming or a gate is open (defensive — the UI also
      // disables the input).
      if (state.streaming || state.openGates.length > 0) return;
      dispatch({ __local: "user-turn", text });
      connRef.current?.sendMessage(text);
    },
    resolveGate: (gateId, answer) => connRef.current?.answerGate(gateId, answer),
    approveGate: (gateId) => connRef.current?.approveGate(gateId),
    cancel: () => connRef.current?.cancel(),
    reconnect: (workingDir) => {
      if (workingDir) workingDirRef.current = workingDir;
      connRef.current?.stop();
      setGeneration((g) => g + 1); // re-run the effect with a fresh connection
    },
  };
}
