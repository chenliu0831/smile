/**
 * The Smile Daemon REST request/response JSON shapes (ADR-0002), authored once here.
 * Mirrors the JAX-RS records in `serve/.../daemon/{SqlResource,DatasetResource,
 * TablesResource,DataResource}.java`.
 *
 * SCOPE: only the JSON envelopes cross this schema. SELECT results travel as an Arrow IPC
 * stream with status in `X-Smile-*` headers (ARROW_HEADERS below names them) — the bytes
 * are out-of-band and deliberately NOT modelled. The TS client's `SqlQueryResult` (which
 * holds a parsed `arrow.Table`) is a client-only type, not a wire shape.
 */
import { Type as T, type Static, type TSchema } from "@sinclair/typebox";

function Open<P extends Record<string, TSchema>>(properties: P) {
  return T.Object(properties, { additionalProperties: true });
}

/** POST /api/v1/sql request body. `maxRows` optional (daemon clamps/defaults). */
export const SqlRequest = Open({
  sql: T.String(),
  maxRows: T.Optional(T.Number()),
});

/** POST /api/v1/sql/save request body. `overwrite` defaults false daemon-side. */
export const SaveRequest = Open({
  name: T.String(),
  select: T.String(),
  overwrite: T.Optional(T.Boolean()),
});

/**
 * JSON response for non-SELECT statements and for save (kind="save"). `rowsAffected` is
 * null for DDL/save (Java `Integer`, JSON null). `kind` is "ddl" | "dml" | "save"; the TS
 * client narrows "dml" vs everything-else, so any string is structurally valid here.
 */
export const ExecResult = Open({
  kind: T.String(),
  ok: T.Boolean(),
  rowsAffected: T.Union([T.Number(), T.Null()]),
  tables: T.Array(T.String()),
});

/** JSON error body returned with a non-2xx status (SqlError record). */
export const SqlError = Open({
  error: T.String(),
});

/** One column's schema (shared by /dataset and /tables; ColumnInfo record, defined 4x today). */
export const ColumnInfo = Open({
  name: T.String(),
  type: T.String(),
});

/** GET /api/v1/dataset response (DatasetResource.DatasetInfo). Preview is column-oriented. */
export const DatasetInfo = Open({
  fileName: T.String(),
  nrow: T.Number(),
  ncol: T.Number(),
  columns: T.Array(ColumnInfo),
  // column name -> preview values (heterogeneous cell values).
  preview: T.Record(T.String(), T.Array(T.Unknown())),
});

/** One entry of GET /api/v1/tables (TablesResource.TableInfo). `definition` null when unknown. */
export const TableInfo = Open({
  name: T.String(),
  columns: T.Array(ColumnInfo),
  definition: T.Union([T.String(), T.Null()]),
});

/** GET /api/v1/tables response: a list of TableInfo. */
export const TablesResponse = T.Array(TableInfo, { $id: "TablesResponse" });

/** GET /api/v1/data/{ref} response: column-oriented JSON (DataResource). */
export const ColumnTable = T.Record(T.String(), T.Array(T.Unknown()), { $id: "ColumnTable" });

/**
 * The daemon's SQL-result status headers (SqlResource.runQuery). Not a JSON body — named
 * here so the TS client and the harness share ONE definition of the header keys instead of
 * re-typing the strings. Values are stringified ints / "true"|"false" on the wire.
 */
export const ARROW_HEADERS = {
  rows: "X-Smile-Rows",
  cols: "X-Smile-Cols",
  elapsedMs: "X-Smile-Elapsed-Ms",
  truncated: "X-Smile-Truncated",
} as const;

/** The Arrow IPC content-type the daemon streams SELECT results as. */
export const ARROW_STREAM_CONTENT_TYPE = "application/vnd.apache.arrow.stream";

/** The daemon's REST path prefix (application.properties `quarkus.rest.path`). */
export const API_PREFIX = "/api/v1";

export type SqlRequest = Static<typeof SqlRequest>;
export type SaveRequest = Static<typeof SaveRequest>;
export type ExecResult = Static<typeof ExecResult>;
export type SqlError = Static<typeof SqlError>;
export type ColumnInfo = Static<typeof ColumnInfo>;
export type DatasetInfo = Static<typeof DatasetInfo>;
export type TableInfo = Static<typeof TableInfo>;
export type TablesResponse = Static<typeof TablesResponse>;
export type ColumnTable = Static<typeof ColumnTable>;
