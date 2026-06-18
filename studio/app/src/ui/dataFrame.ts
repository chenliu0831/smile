/**
 * The pure data-transform seam for the Data Grid (ADR-0007): turns tabular data into
 * an Arrow Frame (Apache Arrow IPC bytes) that Perspective ingests directly with no
 * JSON conversion. WASM-free, so this is the unit-testable layer — DataGrid.tsx adds
 * the Perspective/WASM rendering on top.
 */
import * as arrow from "apache-arrow";

export interface DataGridColumns {
  /** Column order, left-to-right. */
  columns: string[];
  /** Row objects keyed by column name. */
  rows: Record<string, unknown>[];
}

export type DataGridData = arrow.Table | DataGridColumns;

/** Build an Arrow Table from plain columns + rows, inferring column types. */
export function columnsToArrow({ columns, rows }: DataGridColumns): arrow.Table {
  const arrays: Record<string, (string | number | null)[]> = {};
  for (const col of columns) {
    arrays[col] = rows.map((r) => {
      const v = r[col];
      return v === undefined ? null : (v as string | number | null);
    });
  }
  return arrow.tableFromArrays(arrays);
}

/** Serialize the incoming data to an Arrow IPC byte buffer — the Arrow Frame. */
export function toArrowIPC(data: DataGridData): Uint8Array {
  const table = data instanceof arrow.Table ? data : columnsToArrow(data);
  return arrow.tableToIPC(table, "file");
}
