/**
 * `useRun` — the React entry point to the per-session Run store (Zustand).
 *
 * The store (store/runStore.ts) holds all state across three slices (session / connection /
 * data); this hook creates one store per mount, drives its connect/teardown lifecycle, and
 * exposes a `RunController` — the SAME flat surface the old god-hook returned, so every
 * existing consumer and test is unchanged. New code should prefer subscribing to the store
 * via `useRunContext`/selectors (RunContext.tsx); this controller is the compatibility shell.
 *
 * @param connect the connection factory. Defaults to the real `connectRun`; the replay-
 *   fixture harness injects one returning a MockRunPlayer over captured daemon frames, so the
 *   whole connect→run→summarize flow is driven through the real store + UI without a backend.
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { connectRun } from "../daemon/connect";
import { createRunStore, type RunStoreApi } from "../store/runStore";
import type { RunState } from "../daemon/runState";
import type { LoadedDataset } from "../daemon/dataset";
import type { DatasetInfo } from "../daemon/datasetInfo";
import type { ConnectionMode } from "../daemon/connect";

export interface RunController {
  state: RunState;
  dataset: LoadedDataset | null;
  datasetInfo: DatasetInfo | null;
  httpBase: string | null;
  mode: ConnectionMode;
  canLoadDataset: boolean;
  addData: () => Promise<string | null>;
  loadDataset: () => Promise<void>;
  sendMessage: (text: string) => void;
  resolveGate: (gateId: string, answer?: string) => void;
  approveGate: (gateId: string) => void;
  cancel: () => void;
  reconnect: (workingDir?: string) => void;
  /** The underlying store API, for components that prefer selector subscriptions. */
  store: RunStoreApi;
}

export function useRun(connect: typeof connectRun = connectRun): RunController {
  // One store per mount. The factory identity is captured once (a later prop change does not
  // recreate the store — matching the old hook, which keyed its connect effect on generation).
  const storeRef = useRef<RunStoreApi>();
  if (!storeRef.current) storeRef.current = createRunStore(connect);
  const store = storeRef.current;

  // Subscribe to the whole store so the controller reflects live state (the old hook
  // re-rendered on every reducer dispatch; this preserves that).
  const s = useStore(store);

  // Demo/screenshot aid: ?auto sends an opening message + auto-answers gates.
  const [auto] = useState(
    () => typeof window !== "undefined" && window.location.search.includes("auto"),
  );

  useEffect(() => {
    let disposed = false;
    let unsubAuto: (() => void) | undefined;
    const api = store.getState();
    // ?auto: auto-answer gates as they open, and kick off an opening message after connect.
    if (auto) {
      unsubAuto = store.subscribe((st) => {
        const gate = st.session.openGates[0];
        if (gate) setTimeout(() => store.getState().resolveGate(gate.id, "AUC"), 200);
      });
    }
    void api.connect(api.workingDir).then(() => {
      if (disposed || !auto) return;
      setTimeout(() => store.getState().sendMessage("Analyze the dataset and build the best model."), 150);
    });
    return () => {
      disposed = true;
      unsubAuto?.();
      store.getState().teardown();
    };
    // One-time per store (mount). reconnect() drives subsequent reconnections internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  return {
    state: s.session,
    dataset: s.dataset,
    datasetInfo: s.datasetInfo,
    httpBase: s.httpBase,
    mode: s.mode,
    canLoadDataset: s.canLoadDataset,
    addData: s.addData,
    loadDataset: s.loadDataset,
    sendMessage: s.sendMessage,
    resolveGate: s.resolveGate,
    approveGate: s.approveGate,
    cancel: s.cancel,
    reconnect: s.reconnect,
    store,
  };
}
