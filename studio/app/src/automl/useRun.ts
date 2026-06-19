import { useEffect, useReducer, useRef, useState } from "react";
import { initialRunState, reduceRun, appendUserTurn, type RunState } from "../daemon/runState";
import { connectRun } from "../daemon/connect";
import { pickAndLoadDataset, canLoadDataset, type LoadedDataset } from "../daemon/dataset";
import { fetchDatasetInfo, type DatasetInfo } from "../daemon/datasetInfo";
import type { RunConnection } from "../daemon/wsClient";
import type { DaemonMessage } from "../daemon/protocol";

export interface RunController {
  state: RunState;
  /** The dataset currently in scope (staged into the agent's input/), if any. */
  dataset: LoadedDataset | null;
  /** Native schema + preview of the loaded dataset (from the daemon), if available. */
  datasetInfo: DatasetInfo | null;
  /** Daemon HTTP base for direct fetches (e.g. the explorer's full-data load), or null. */
  httpBase: string | null;
  /** Whether dataset loading is available (desktop app only). */
  canLoadDataset: boolean;
  /** Prompt for a dataset file, stage it, and restart the session against it. */
  loadDataset: () => Promise<void>;
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

/** Local actions the UI dispatches that aren't daemon messages. */
type LocalAction =
  | { __local: "user-turn"; text: string }
  /** Wipe session state (turns/stages/artifacts) — e.g. when a new dataset is loaded. */
  | { __local: "reset" };

function rootReducer(state: RunState, action: DaemonMessage | LocalAction): RunState {
  if ("__local" in action) {
    if (action.__local === "reset") return initialRunState;
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
  const [dataset, setDataset] = useState<LoadedDataset | null>(null);
  const [datasetInfo, setDatasetInfo] = useState<DatasetInfo | null>(null);
  const [httpBase, setHttpBase] = useState<string | null>(null);
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
      // If a real daemon is attached, fetch native dataset insights (P3).
      const base = conn.httpBase();
      setHttpBase(base);
      if (base) {
        fetchDatasetInfo(base).then((info) => {
          if (!disposed) setDatasetInfo(info);
        });
      } else {
        setDatasetInfo(null);
      }
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
    dataset,
    datasetInfo,
    httpBase,
    canLoadDataset: canLoadDataset(),
    loadDataset: async () => {
      const loaded = await pickAndLoadDataset();
      if (!loaded) return; // cancelled
      setDataset(loaded);
      setDatasetInfo(null); // cleared until the new daemon reports it
      workingDirRef.current = loaded.workingDir;
      dispatch({ __local: "reset" }); // clear prior dataset's turns/stages/artifacts
      connRef.current?.stop();
      setGeneration((g) => g + 1); // reconnect against the new working dir
    },
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
      dispatch({ __local: "reset" }); // fresh connection => fresh session state
      connRef.current?.stop();
      setGeneration((g) => g + 1); // re-run the effect with a fresh connection
    },
  };
}
