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

/** A column-oriented table as the daemon's /data/{ref} endpoint returns it: name → values. */
export type ColumnTable = Record<string, (number | string | null)[]>;

/**
 * Convert the daemon's column-JSON (`{col: [v0, v1, …]}`) into the row-oriented
 * {@link DataGridColumns} the Data Grid ingests. Pure + WASM-free → unit-tested. Column
 * order follows the object's key order; row count is the longest column (short columns are
 * padded with null so ragged input can't throw).
 */
export function columnTableToGrid(table: ColumnTable): DataGridColumns {
  const columns = Object.keys(table);
  const nRows = columns.reduce((n, c) => Math.max(n, table[c]?.length ?? 0), 0);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < nRows; i++) {
    const row: Record<string, unknown> = {};
    for (const c of columns) row[c] = table[c]?.[i] ?? null;
    rows.push(row);
  }
  return { columns, rows };
}

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

/** A Perspective column type (subset we emit). "integer" is i32; "float" is f64. */
export type PerspectiveType = "integer" | "float" | "string" | "boolean" | "date" | "datetime";

/** An explicit schema + row records — Perspective's reliable JSON ingest shape. */
export interface PerspectiveData {
  schema: Record<string, PerspectiveType>;
  rows: Record<string, unknown>[];
}

/**
 * Coerce a single Arrow cell to a Perspective-safe JS value. The key fix: DuckDB integers
 * arrive as Arrow Int64 → JS BigInt, which Perspective's WASM rejects with "null pointer
 * passed to rust". We convert every BigInt → Number (the column is declared "float"/f64,
 * exact for |v| ≤ 2^53 — well beyond any realistic id/count/measurement). Arrow row objects
 * also expose nested values (struct/list) as objects; stringify those for JSON safety.
 */
function safeCell(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "boolean" || typeof v === "number" || typeof v === "string") return v;
  return String(v); // struct/list/decimal/date objects → display string
}

/**
 * Map an Arrow type to a Perspective column type. DuckDB emits integer columns as BIGINT →
 * Arrow Int64, whose values routinely exceed i32 (e.g. id columns); Perspective "integer" is
 * only i32, so ALL 64-bit ints map to "float" (f64) to avoid overflow while keeping numeric
 * sort/aggregate. Narrow ints (≤32-bit) stay "integer".
 */
function perspectiveType(t: arrow.DataType): PerspectiveType {
  if (arrow.DataType.isInt(t)) return (t as arrow.Int).bitWidth >= 64 ? "float" : "integer";
  if (arrow.DataType.isFloat(t) || arrow.DataType.isDecimal(t)) return "float";
  if (arrow.DataType.isBool(t)) return "boolean";
  if (arrow.DataType.isTimestamp(t)) return "datetime";
  if (arrow.DataType.isDate(t)) return "date";
  return "string";
}

/**
 * Convert tabular data to Perspective's JSON ingest shape. We feed Perspective an explicit
 * schema + JSON rows (NOT re-encoded Arrow IPC) because its WASM Arrow reader chokes on
 * common DuckDB output — notably Int64 columns ("null pointer passed to rust"). The explicit
 * schema also prevents Perspective's own type inference from picking i32 and overflowing a
 * large integer column. JSON ingest with a declared schema is the robust path.
 */
export function toPerspectiveData(data: DataGridData): PerspectiveData {
  const table = data instanceof arrow.Table ? data : columnsToArrow(data);
  const schema: PerspectiveData["schema"] = {};
  for (const f of table.schema.fields) schema[f.name] = perspectiveType(f.type);
  const names = table.schema.fields.map((f) => f.name);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < table.numRows; i++) {
    const row = table.get(i);
    const out: Record<string, unknown> = {};
    for (const name of names) out[name] = safeCell(row?.[name]);
    rows.push(out);
  }
  return { schema, rows };
}
