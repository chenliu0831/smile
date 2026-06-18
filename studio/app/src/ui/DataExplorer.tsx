/**
 * The Explore panel (P5) — a Sigma-style interactive data workspace. Loads the full
 * dataset (capped daemon-side) and renders a Perspective viewer with its settings
 * sidebar enabled, so the user can pivot (group_by / split_by), filter, aggregate, sort,
 * and switch between grid and chart views (scatter / bar / line / heatmap via d3fc) —
 * all live, client-side, with no round-trips after the initial load.
 */
import { useEffect, useMemo, useState } from "react";
import { useRunContext } from "../automl/RunContext";
import { fetchDatasetInfo, type DatasetInfo } from "../daemon/datasetInfo";
import { DataGrid, type DataGridColumns } from "./DataGrid";

function toGrid(info: DatasetInfo): DataGridColumns {
  const columns = info.columns.map((c) => c.name);
  const nrows = Math.max(0, ...columns.map((c) => info.preview[c]?.length ?? 0));
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < nrows; i++) {
    const row: Record<string, unknown> = {};
    for (const c of columns) row[c] = info.preview[c]?.[i] ?? null;
    rows.push(row);
  }
  return { columns, rows };
}

export function DataExplorer() {
  const { httpBase, dataset, datasetInfo, canLoadDataset } = useRunContext();
  const [full, setFull] = useState<DatasetInfo | null>(null);
  const [loading, setLoading] = useState(false);

  // Load the FULL frame for real exploration whenever a daemon + dataset are present.
  // Keyed on fileName so changing datasets refetches.
  useEffect(() => {
    let cancelled = false;
    if (!httpBase) {
      setFull(null);
      return;
    }
    setLoading(true);
    fetchDatasetInfo(httpBase, true)
      .then((info) => {
        if (!cancelled) setFull(info);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [httpBase, datasetInfo?.fileName]);

  const grid = useMemo(() => (full ? toGrid(full) : null), [full]);

  if (!httpBase) {
    return (
      <div className="surface">
        <div className="surface-note">
          The interactive explorer — pivot, filter, aggregate, and chart your data live —
          opens once a dataset is loaded into the desktop app.
        </div>
        <div className="surface-empty">
          {canLoadDataset ? "Use “Load Dataset” in the toolbar to begin." : "Available in the desktop app."}
        </div>
      </div>
    );
  }

  if (loading && !grid) {
    return <div className="surface surface-empty">Loading dataset for exploration…</div>;
  }

  if (!grid) {
    return (
      <div className="surface surface-empty">
        {dataset ? "No data to explore yet." : "Load a dataset to explore it."}
      </div>
    );
  }

  return (
    <div className="surface explorer">
      <div className="explorer-hint">
        Drag columns into <em>Group By</em> / <em>Split By</em>, add filters, switch to a
        chart — {full ? full.nrow.toLocaleString() : ""} rows, live.
      </div>
      <div className="explorer-grid">
        {/* settings:true exposes Perspective's pivot/filter/aggregate sidebar. */}
        <DataGrid data={grid} settings height={520} />
      </div>
    </div>
  );
}
