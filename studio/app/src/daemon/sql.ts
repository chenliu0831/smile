/**
 * Client for the daemon's SQL console endpoint (POST /api/v1/sql). One statement per call,
 * run against the shared DuckDB session the agent also uses. A SELECT/WITH returns an Arrow
 * IPC stream we parse into an arrow.Table for the result grid; any other statement returns
 * JSON describing the effect (rows affected, current tables).
 */
import * as arrow from "apache-arrow";

/** Result of a SELECT/WITH: a table plus the daemon's status headers. */
export interface SqlQueryResult {
  kind: "query";
  table: arrow.Table;
  rows: number;
  cols: number;
  elapsedMs: number;
  truncated: boolean;
}

/** Result of a DDL/DML statement: no grid, just an effect summary. */
export interface SqlExecResult {
  kind: "ddl" | "dml";
  ok: boolean;
  rowsAffected: number | null;
  tables: string[];
}

export type SqlResult = SqlQueryResult | SqlExecResult;

/** A SQL error surfaced by the daemon (syntax, guard violation, timeout). */
export class SqlRunError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SqlRunError";
  }
}

const ARROW_STREAM = "application/vnd.apache.arrow.stream";

/**
 * Runs one SQL statement on the shared session.
 *
 * @param httpBase the daemon HTTP base (e.g. http://127.0.0.1:PORT/api/v1).
 * @param sql a single SQL statement.
 * @param maxRows optional cap on returned SELECT rows.
 */
export async function runSql(httpBase: string, sql: string, maxRows?: number): Promise<SqlResult> {
  const res = await fetch(`${httpBase}/sql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, maxRows }),
  });

  const contentType = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    // Errors come back as JSON { error }. Fall back to status text.
    let message = `SQL request failed (${res.status})`;
    if (contentType.includes("application/json")) {
      const body = await res.json().catch(() => null);
      if (body?.error) message = body.error;
    }
    throw new SqlRunError(message, res.status);
  }

  if (contentType.includes(ARROW_STREAM) || contentType.includes("arrow")) {
    const buf = await res.arrayBuffer();
    // tableFromIPC auto-detects the stream vs file IPC variant; the daemon writes the
    // stream variant via smile.io.Arrow (ArrowStreamWriter).
    const table = arrow.tableFromIPC(new Uint8Array(buf));
    return {
      kind: "query",
      table,
      rows: intHeader(res, "X-Smile-Rows", table.numRows),
      cols: intHeader(res, "X-Smile-Cols", table.numCols),
      elapsedMs: intHeader(res, "X-Smile-Elapsed-Ms", 0),
      truncated: res.headers.get("X-Smile-Truncated") === "true",
    };
  }

  // Non-SELECT: JSON effect summary.
  const body = await res.json();
  return {
    kind: body.kind === "dml" ? "dml" : "ddl",
    ok: !!body.ok,
    rowsAffected: body.rowsAffected ?? null,
    tables: Array.isArray(body.tables) ? body.tables : [],
  };
}

function intHeader(res: Response, name: string, fallback: number): number {
  const v = res.headers.get(name);
  const n = v == null ? NaN : parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
