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

import { toArrowIPC, type DataGridData } from "./dataFrame";

export type { DataGridData, DataGridColumns } from "./dataFrame";
export { toArrowIPC, columnsToArrow } from "./dataFrame";

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

export function DataGrid({ data, height = 360, settings = false, plugin = "Datagrid", config }: DataGridProps) {
  const ref = useRef<HTMLPerspectiveViewerElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let viewerEl: HTMLPerspectiveViewerElement | null = null;

    (async () => {
      try {
        const perspective = await loadPerspective();
        if (disposed || !ref.current) return;

        const ipc = toArrowIPC(data);
        const worker = await perspective.worker();
        const table = await worker.table(ipc.buffer as ArrayBuffer);

        viewerEl = ref.current;
        await viewerEl.load(Promise.resolve(table));
        await viewerEl.restore({
          plugin,
          theme: "Pro Dark",
          settings,
          ...(config ?? {}),
        });
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      disposed = true;
      // Best-effort teardown; viewer.delete() also frees the backing table.
      viewerEl?.delete?.().catch(() => {});
    };
  }, [data, settings, plugin, config]);

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
