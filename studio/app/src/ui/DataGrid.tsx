/**
 * The Data Grid (ADR-0007): the virtualized table component that renders all tabular
 * data by streaming Arrow Frames into Perspective (FINOS), in datagrid mode, themed
 * dark to match styles.css. Takes either an Apache Arrow `Table` or plain
 * `{ columns, rows }` (see ./dataFrame).
 *
 * Perspective is WASM-backed: its query engine and viewer load as separate WebAssembly
 * modules. We initialize them once (init_server / init_client) using the URLs Vite
 * emits for the `.wasm` assets. In environments without WebAssembly (e.g. jsdom under
 * Vitest) initialization fails; we surface that as an error state, and the pure
 * data-transform layer in ./dataFrame is what the tests exercise instead.
 */
import { useEffect, useRef, useState } from "react";

// NOTE: Perspective and its `.wasm` assets are imported *lazily* inside the effect,
// not at module top-level. Importing @finos/perspective eagerly instantiates its WASM
// engine on load, which throws under jsdom/Vitest and would take down any test that
// merely imports a component tree containing the Data Grid. Deferring the import keeps
// the WASM off the import path so the pure transform layer (./dataFrame) stays testable.
import type { HTMLPerspectiveViewerElement } from "@finos/perspective-viewer";

import { toPerspectiveData, type DataGridData } from "./dataFrame";

export type { DataGridData, DataGridColumns } from "./dataFrame";
export { toArrowIPC, columnsToArrow, toPerspectiveData } from "./dataFrame";

type PerspectiveModule = typeof import("@finos/perspective")["default"];

let perspectivePromise: Promise<PerspectiveModule> | null = null;

/** Load the Perspective modules and initialize the server + viewer WASM exactly once. */
function loadPerspective(): Promise<PerspectiveModule> {
  if (!perspectivePromise) {
    perspectivePromise = (async () => {
      const [{ default: perspective }, { default: perspectiveViewer }] = await Promise.all([
        import("@finos/perspective"),
        import("@finos/perspective-viewer"),
      ]);
      await import("@finos/perspective-viewer-datagrid");
      // The d3fc plugin adds Sigma-style chart views (scatter/line/bar/heatmap) the
      // explorer can switch to from the plugin picker.
      await import("@finos/perspective-viewer-d3fc");
      await import("@finos/perspective-viewer/dist/css/pro-dark.css");
      const [{ default: SERVER_WASM }, { default: CLIENT_WASM }] = await Promise.all([
        import("@finos/perspective/dist/wasm/perspective-server.wasm?url"),
        import("@finos/perspective-viewer/dist/wasm/perspective-viewer.wasm?url"),
      ]);
      await Promise.all([
        perspective.init_server(fetch(SERVER_WASM)),
        perspectiveViewer.init_client(fetch(CLIENT_WASM)),
      ]);
      return perspective;
    })();
  }
  return perspectivePromise;
}

export interface DataGridProps {
  data: DataGridData;
  height?: number;
  /** Show Perspective's pivot/filter/aggregate sidebar (the Sigma-style explorer chrome). */
  settings?: boolean;
  /** Initial plugin ("Datagrid", "X/Y Scatter", "Y Bar", "Y Line", "Heatmap", …). */
  plugin?: string;
  /** Optional initial view config (group_by / split_by / aggregates / filter / sort). */
  config?: Record<string, unknown>;
}

type PerspectiveTable = Awaited<ReturnType<Awaited<ReturnType<PerspectiveModule["worker"]>>["table"]>>;

export function DataGrid({ data, height = 360, settings = false, plugin = "Datagrid", config }: DataGridProps) {
  const ref = useRef<HTMLPerspectiveViewerElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The <perspective-viewer> is a SINGLE persistent WASM element reused across data-prop
  // changes. Its load()/restore()/delete() each touch a shared WASM model pointer; if a
  // superseded render's teardown interleaves with a newer render's load(), that pointer is
  // freed mid-use and Perspective throws "null pointer passed to rust" (the crash the user
  // hit on summarize, whose silent auto-refresh re-renders on every agent tool-call tick).
  // The fix: SERIALIZE every viewer operation through one promise chain so they can never
  // overlap, gate each by a generation counter so a stale render no-ops, swap the table in
  // place (never delete the viewer on a data change), and reuse ONE worker (the summarize
  // tick storm would otherwise leak a worker per render).
  const opChain = useRef<Promise<void>>(Promise.resolve());
  const genRef = useRef(0);
  const loadedTable = useRef<PerspectiveTable | null>(null);
  const workerRef = useRef<Awaited<ReturnType<PerspectiveModule["worker"]>> | null>(null);
  // A pending viewer-disposal timer (see the unmount effect). React StrictMode (dev) runs
  // setup→cleanup→setup on the SAME mounted node, so the unmount cleanup fires on a
  // simulated unmount; disposing the shared viewer there would free its WASM model while the
  // component is still mounted (the next data effect's load() would then hit a freed pointer —
  // the very "null pointer passed to rust" crash). So disposal is DEFERRED to a macrotask and
  // CANCELLED if the data effect re-runs (a real remount re-runs it synchronously after).
  const disposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // A (re)mount/data-change ran: cancel any pending disposal from a StrictMode simulated
    // unmount so we never free the viewer that this live render is about to use.
    if (disposeTimer.current !== null) {
      clearTimeout(disposeTimer.current);
      disposeTimer.current = null;
    }
    const myGen = ++genRef.current;
    const stale = () => genRef.current !== myGen;

    opChain.current = opChain.current.then(async () => {
      if (stale() || !ref.current) return; // a newer render superseded us before our turn
      let table: PerspectiveTable | null = null;
      try {
        const perspective = await loadPerspective();
        if (stale() || !ref.current) return;

        // Ingest via an explicit schema + JSON rows rather than re-encoded Arrow IPC:
        // Perspective's WASM Arrow reader chokes on DuckDB Int64 columns ("null pointer
        // passed to rust"), and its inference would pick i32 and overflow large ids.
        // dataFrame.toPerspectiveData maps 64-bit ints → float and BigInt → number.
        const { schema, rows } = toPerspectiveData(data);
        if (!workerRef.current) workerRef.current = await perspective.worker();
        // Create the table from the schema first (locks column types), then load rows.
        // A `{col: type}` object is Perspective's documented "schema" table input, but the
        // shipped .d.ts omits that overload — cast through unknown to the data-input type.
        table = await workerRef.current.table(schema as unknown as Record<string, unknown[]>);
        if (rows.length) await table.update(rows);
        if (stale() || !ref.current) { await table.delete?.().catch(() => {}); return; }

        // Swap the table into the persistent viewer. We do NOT delete the viewer here — only
        // the previously displayed table, once the new one is loaded — so the shared model
        // pointer is never freed while a (serialized) load/restore could touch it.
        await ref.current.load(Promise.resolve(table));
        await ref.current.restore({ plugin, theme: "Pro Dark", settings, ...(config ?? {}) });
        const prev = loadedTable.current;
        loadedTable.current = table;
        table = null; // ownership transferred to loadedTable; don't free in catch
        await prev?.delete?.().catch(() => {});
        if (!stale()) setError(null);
      } catch (e) {
        await table?.delete?.().catch(() => {});
        if (!stale()) setError(e instanceof Error ? e.message : String(e));
      }
    }).catch(() => {});
    // Bumping the generation in cleanup makes any queued-but-not-yet-run op for THIS data
    // no-op. We deliberately do NOT tear the viewer down on a data change (that teardown
    // racing the next load is the bug); the unmount effect below owns viewer disposal.
    return () => { genRef.current++; };
  }, [data, settings, plugin, config]);

  // Viewer/table/worker disposal. DEFERRED to a macrotask so a React StrictMode simulated
  // unmount (which immediately remounts) cancels it (via the data effect above) instead of
  // freeing the live viewer's WASM model out from under the next render. On a REAL unmount no
  // remount follows, so the timer fires and tears down at the TAIL of the op chain (never
  // interleaving with an in-flight load/restore). Capture the element now (refs are attached
  // before effects run) since ref.current may be null by the time the timer fires.
  useEffect(() => {
    const viewerEl = ref.current;
    return () => {
      genRef.current++;
      disposeTimer.current = setTimeout(() => {
        disposeTimer.current = null;
        const worker = workerRef.current;
        workerRef.current = null;
        opChain.current = opChain.current.then(async () => {
          await loadedTable.current?.delete?.().catch(() => {});
          loadedTable.current = null;
          await viewerEl?.delete?.().catch(() => {});
          // Terminate the reused worker (Web Worker + WASM heap) so a real unmount doesn't
          // leak it; a remount lazily creates a fresh one (workerRef was nulled above).
          await worker?.terminate?.().catch?.(() => {});
        }).catch(() => {});
      }, 0);
    };
  }, []);

  if (error) {
    return (
      <div style={{ color: "var(--bad)", fontSize: 12, padding: 8 }}>
        Data Grid failed to render: {error}
      </div>
    );
  }

  return (
    <perspective-viewer
      ref={ref}
      class="smile-datagrid"
      style={{ height, width: "100%" }}
    />
  );
}
