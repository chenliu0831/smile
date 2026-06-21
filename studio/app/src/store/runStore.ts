/**
 * The Run store — one Zustand store per session, composed of three slices:
 *   - sessionSlice    (conversation/run state, via the pure reduceRun)
 *   - connectionSlice (the live daemon connection + chat/gate actions)
 *   - dataSlice       (datasets + in-session SQL import)
 *
 * This replaces the old `useRun` "god hook": the three concerns are now separable slices
 * behind one store, and cross-slice glue (reconnect) lives here. A FRESH store is created
 * per RunProvider (not a module singleton) so each mount — and each test — is isolated, and
 * so the connection factory can be injected (the replay-harness seam).
 *
 * Selectors live in `selectors.ts`; components subscribe to those rather than re-deriving
 * `isBusy` / `datasetName` / the leaderboard artifact in many places (the review's C6).
 */
import { createStore } from "zustand/vanilla";
import { connectRun as defaultConnectRun } from "../daemon/connect";
import { createSessionSlice, type SessionSlice } from "./sessionSlice";
import { createConnectionSlice, type ConnectionSlice } from "./connectionSlice";
import { createDataSlice, type DataSlice } from "./dataSlice";

/** Cross-slice fields owned by the root store. */
interface RootSlice {
  /** The agent's working directory (where input/<dataset> lives); reconnect targets it. */
  workingDir: string;
  /** Reset session state + reopen the connection (e.g. after loading a dataset). */
  reconnect: (workingDir?: string) => void;
}

export type RunStore = RootSlice & SessionSlice & ConnectionSlice & DataSlice;

/** Create a fresh store. `connectRun` is injected (defaults to the real factory). */
export function createRunStore(connectRun: typeof defaultConnectRun = defaultConnectRun) {
  return createStore<RunStore>()((set, get, store) => ({
    workingDir: ".",
    reconnect: (workingDir) => {
      if (workingDir) set({ workingDir });
      get().resetSession(); // fresh connection => fresh session state
      get().teardown();
      void get().connect(get().workingDir);
    },
    ...createSessionSlice(set, get, store),
    ...createConnectionSlice(connectRun)(set, get, store),
    ...createDataSlice(set, get, store),
  }));
}

export type RunStoreApi = ReturnType<typeof createRunStore>;
