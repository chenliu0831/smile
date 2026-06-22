/**
 * Fetches native dataset insights from the daemon: schema, row/column counts, and a
 * column-oriented preview for a NAMED table in the shared DuckDB session, projected straight
 * from DuckDB. The UI feeds the preview into the Perspective grid (via the DataGrid Arrow
 * seam), so the user sees real schema + values for an imported table — independent of the
 * agent/LLM. "Loaded" means a real session table, NOT a file in input/.
 */
export interface ColumnInfo {
  name: string;
  type: string;
}

export interface DatasetInfo {
  /** The session table name (shown as the dataset name in the UI). */
  fileName: string;
  nrow: number;
  ncol: number;
  columns: ColumnInfo[];
  /** column name -> preview values */
  preview: Record<string, unknown[]>;
}

/** Derive the daemon HTTP base from a ws:// URL (same host/port, /api/v1 prefix). */
export function httpBaseFromWs(wsUrl: string): string {
  const u = new URL(wsUrl);
  const proto = u.protocol === "wss:" ? "https:" : "http:";
  return `${proto}//${u.host}/api/v1`;
}

/**
 * Fetch schema + preview for a named session table, or null if it doesn't exist / the daemon
 * is unavailable. `full` requests the whole frame (capped daemon-side) for the interactive
 * explorer; the default returns a bounded preview for the Data panel.
 *
 * @param table the session table name (required — there is no filesystem auto-discovery).
 */
export async function fetchDatasetInfo(
  httpBase: string,
  table: string,
  full = false,
  fetchFn: typeof fetch = fetch,
): Promise<DatasetInfo | null> {
  if (!table) return null;
  try {
    const q = new URLSearchParams({ table });
    if (full) q.set("full", "true");
    const res = await fetchFn(`${httpBase}/dataset?${q.toString()}`);
    if (!res.ok) return null;
    return (await res.json()) as DatasetInfo;
  } catch {
    return null;
  }
}
