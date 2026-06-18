/**
 * The Data panel (P3): native dataset insights — schema, row/column counts, and a
 * scrollable preview rendered in the Perspective Data Grid. Driven by the daemon's
 * /dataset endpoint (smile.io.Read), so the user sees real schema + values the instant
 * a dataset is loaded, independent of the agent.
 */
import { useMemo } from "react";
import { useRunContext } from "../automl/RunContext";
import { DataGrid, type DataGridColumns } from "./DataGrid";

export function DataPanel() {
  const { datasetInfo, dataset, canLoadDataset } = useRunContext();

  const grid = useMemo<DataGridColumns | null>(() => {
    if (!datasetInfo) return null;
    const columns = datasetInfo.columns.map((c) => c.name);
    const nrows = Math.max(0, ...columns.map((c) => datasetInfo.preview[c]?.length ?? 0));
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < nrows; i++) {
      const row: Record<string, unknown> = {};
      for (const c of columns) row[c] = datasetInfo.preview[c]?.[i] ?? null;
      rows.push(row);
    }
    return { columns, rows };
  }, [datasetInfo]);

  if (!datasetInfo) {
    return (
      <div className="surface">
        <div className="surface-note">
          Native dataset insights — schema, statistics, and a live preview — appear here
          once a dataset is loaded.
        </div>
        <div className="surface-empty">
          {dataset
            ? "Loading dataset insights…"
            : canLoadDataset
              ? "Use “Load Dataset” in the toolbar to begin."
              : "Dataset loading is available in the desktop app."}
        </div>
      </div>
    );
  }

  return (
    <div className="surface data-panel">
      <div className="data-header">
        <strong>{datasetInfo.fileName}</strong>
        <span className="data-dims">
          {datasetInfo.nrow.toLocaleString()} rows × {datasetInfo.ncol} columns
        </span>
      </div>
      <div className="data-schema">
        {datasetInfo.columns.map((c) => (
          <span key={c.name} className="schema-col" title={c.type}>
            {c.name} <em>{c.type}</em>
          </span>
        ))}
      </div>
      <div className="data-grid-wrap">{grid && <DataGrid data={grid} height={420} />}</div>
    </div>
  );
}
