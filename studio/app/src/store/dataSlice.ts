/**
 * Data slice — datasets and in-session SQL import.
 *
 * This is the half the architecture review lifted OUT of the old `useRun` god hook: the
 * dataset chip state (`dataset`, `datasetInfo`), the warm "Add data" import (stage + plain
 * CREATE TABLE with collision-retry), and the cold-start load (copy + daemon restart). It
 * lives next to the SQL/dataset clients it drives, not inside the session/connection hub.
 */
import type { StateCreator } from "zustand";
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
import { runSql, SqlRunError } from "../daemon/sql";
import type { RunStore } from "./runStore";

export interface DataSlice {
  /** The dataset currently in scope (staged into the agent's input/), if any. */
  dataset: LoadedDataset | null;
  /** Native schema + preview of the loaded dataset (from the daemon), if available. */
  datasetInfo: DatasetInfo | null;
  /** Whether dataset loading is available (desktop app only). */
  canLoadDataset: boolean;
  setDatasetInfo: (info: DatasetInfo | null) => void;
  /** Re-fetch the daemon's dataset insights for `httpBase` into state. */
  refreshDatasetInfo: (httpBase: string) => Promise<void>;
  /**
   * The single "Add data" action: pick a file, stage it into the RUNNING daemon's input/
   * (no restart — conversation + session preserved), import it as a queryable session table,
   * refresh datasetInfo. Falls back to the cold-start load when no daemon is running. Returns
   * the imported table name, or null if cancelled/unavailable.
   */
  addData: () => Promise<string | null>;
  /**
   * LEGACY cold-start path: prompt for a dataset, copy it into a fresh session dir, and
   * RESTART the daemon there. Retained for when no daemon is running yet.
   */
  loadDataset: () => Promise<void>;
}

export const createDataSlice: StateCreator<RunStore, [], [], DataSlice> = (set, get) => ({
  dataset: null,
  datasetInfo: null,
  canLoadDataset: canLoadDataset(),

  setDatasetInfo: (info) => set({ datasetInfo: info }),

  refreshDatasetInfo: async (httpBase) => {
    // Guard against supersession the same way connect() does: capture the lifecycle token
    // before the await, and drop the result if a teardown/reconnect happened meanwhile — so a
    // stale daemon's late /dataset response can't resurrect old (or blank) insights onto a
    // newer session. connect() fires this un-awaited, so it is NOT covered by connect()'s own
    // epoch check; it must re-check here.
    const token = get().lifecycle();
    const info = await fetchDatasetInfo(httpBase);
    if (get().lifecycle() !== token) return;
    set({ datasetInfo: info });
  },

  addData: async () => {
    const base = get().httpBase;
    // No running daemon yet → fall back to the cold-start load (which launches one).
    if (!base) {
      await get().loadDataset();
      return null;
    }
    const path = await pickDatasetFile();
    if (!path) return null; // cancelled
    const reader = readerForPath(path);
    // Import FIRST (before staging the file) so a failed import never orphans a copied
    // input/ file. NON-DESTRUCTIVE: plain CREATE TABLE; on a name collision disambiguate
    // with a numeric suffix rather than clobbering with CREATE OR REPLACE.
    const baseName = tableNameForPath(path);
    let name = baseName;
    for (let attempt = 1; ; attempt++) {
      try {
        await runSql(base, `CREATE TABLE "${name}" AS SELECT * FROM ${reader}`);
        break;
      } catch (e) {
        if (e instanceof SqlRunError && /already exists/i.test(e.message) && attempt <= 50) {
          name = `${baseName}_${attempt + 1}`; // customers, customers_2, customers_3, …
          continue;
        }
        throw e;
      }
    }
    // Stage the file into the running daemon's input/ so the agent can also read it by the
    // ./input/<file> convention (ADR-0005). Best-effort: the imported table is the primary
    // access path, so a staging failure must not fail the add.
    await stageDataset(path).catch(() => {/* table import already succeeded */});
    // Reflect it without a restart: re-fetch insights, with a local fallback so the chip
    // lights even if /dataset's file-based detection doesn't surface the imported table.
    // Guard the writes against a teardown/reconnect during the awaits (supersession), so a
    // stale add can't land on a newer session. The table name is still returned regardless.
    const token = get().lifecycle();
    const info = await fetchDatasetInfo(base);
    if (get().lifecycle() === token) {
      if (info) set({ datasetInfo: info });
      else set({ dataset: { workingDir: get().workingDir, fileName: name, sizeBytes: 0 } });
    }
    return name;
  },

  loadDataset: async () => {
    const loaded = await pickAndLoadDataset();
    if (!loaded) return; // cancelled
    set({ dataset: loaded, datasetInfo: null }); // info cleared until the new daemon reports it
    get().reconnect(loaded.workingDir); // reset session + reconnect against the new working dir
  },
});
