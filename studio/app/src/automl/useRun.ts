import { useEffect, useReducer, useRef, useState } from "react";
import { initialRunState, reduceRun, appendUserTurn, type RunState } from "../daemon/runState";
import { connectRun, type ConnectionMode } from "../daemon/connect";
import {
  pickAndLoadDataset,
  pickDatasetFile,
  stageDataset,
  tableNameForPath,
  readerForPath,
  canLoadDataset,
  type LoadedDataset,
} from "../daemon/dataset";
import { fetchDatasetInfo, type DatasetInfo } from "../daemon/datasetInfo";
import { runSql } from "../daemon/sql";
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
  /** How the session is connected: a real daemon, the browser demo, or a failed daemon. */
  mode: ConnectionMode;
  /** Whether dataset loading is available (desktop app only). */
  canLoadDataset: boolean;
  /**
   * The single "Add data" action: pick a file, stage it into the RUNNING daemon's input/
   * (no restart — conversation + session preserved), import it as a queryable session table,
   * and refresh datasetInfo so the UI reflects it. Falls back to the cold-start load (which
   * launches a daemon) only when none is running. Returns the imported table name, or null
   * if cancelled/unavailable.
   */
  addData: () => Promise<string | null>;
  /**
   * LEGACY cold-start path: prompt for a dataset, copy it into a fresh session dir, and
   * RESTART the daemon there. Retained for when no daemon is running yet; the warm path is
   * {@link addData}.
   */
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
 *
 * @param connect the connection factory. Defaults to the real `connectRun`; the
 *   replay-fixture test harness injects one returning a `MockRunPlayer` over captured
 *   daemon frames, so the whole connect→run→summarize flow is driven through the real
 *   reducer + UI without a live backend.
 */
export function useRun(connect: typeof connectRun = connectRun): RunController {
  const [state, dispatch] = useReducer(rootReducer, initialRunState);
  const connRef = useRef<RunConnection | null>(null);
  // The factory is captured in a ref so a new identity on re-render never re-runs the
  // connect effect (which is keyed on `generation`, not `connect`).
  const connectRef = useRef(connect);
  connectRef.current = connect;
  const [generation, setGeneration] = useState(0);
  const [dataset, setDataset] = useState<LoadedDataset | null>(null);
  const [datasetInfo, setDatasetInfo] = useState<DatasetInfo | null>(null);
  const [httpBase, setHttpBase] = useState<string | null>(null);
  const [mode, setMode] = useState<ConnectionMode>("demo");
  const workingDirRef = useRef<string>(".");

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let disposed = false;
    // Demo/screenshot aid: ?auto sends an opening message + auto-answers gates.
    const auto = typeof window !== "undefined" && window.location.search.includes("auto");

    connectRef.current(350, workingDirRef.current).then(({ connection: conn, mode }) => {
      if (disposed) {
        conn.stop();
        return;
      }
      connRef.current = conn;
      setMode(mode);
      unsub = conn.subscribe((msg) => {
        // The reducer returns a fresh state ref for every state-changing message (only
        // unknown messages return the same ref), so dispatch alone re-renders — the prior
        // extra force() was a redundant second render per WS frame (UI jank while streaming).
        dispatch(msg);
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

  // Cold-start load: copy into a fresh session dir + restart the daemon there. Shared by the
  // legacy `loadDataset` and the `addData` fallback (when no daemon is running yet).
  const loadDatasetImpl = async () => {
    const loaded = await pickAndLoadDataset();
    if (!loaded) return; // cancelled
    setDataset(loaded);
    setDatasetInfo(null); // cleared until the new daemon reports it
    workingDirRef.current = loaded.workingDir;
    dispatch({ __local: "reset" }); // clear prior dataset's turns/stages/artifacts
    connRef.current?.stop();
    setGeneration((g) => g + 1); // reconnect against the new working dir
  };

  return {
    state,
    dataset,
    datasetInfo,
    httpBase,
    mode,
    canLoadDataset: canLoadDataset(),
    addData: async () => {
      const base = httpBase;
      // No running daemon yet → fall back to the cold-start load (which launches one).
      if (!base) {
        await loadDatasetImpl();
        return null;
      }
      const path = await pickDatasetFile();
      if (!path) return null; // cancelled
      // Stage into the running daemon's input/ so the agent can read ./input/<file>
      // (ADR-0005) — best-effort; the in-session table below is the primary access path.
      await stageDataset(path).catch(() => {/* not fatal: the table import still works */});
      const name = tableNameForPath(path);
      // Fast in-session import (no restart): CREATE OR REPLACE so re-adding a file just
      // refreshes it rather than erroring on a name collision.
      await runSql(base, `CREATE OR REPLACE TABLE "${name}" AS SELECT * FROM ${readerForPath(path)}`);
      // Reflect it in the UI without a restart: re-fetch the daemon's dataset insights.
      const info = await fetchDatasetInfo(base);
      setDatasetInfo(info);
      return name;
    },
    loadDataset: loadDatasetImpl,
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
