/**
 * Fetches native dataset insights from the daemon (P3): schema, row/column counts, and
 * a column-oriented preview computed by smile.io.Read on the daemon side. The UI feeds
 * the preview straight into the Perspective grid (via the DataGrid Arrow seam), so the
 * user sees real schema + values the instant a dataset is loaded — independent of the
 * agent/LLM.
 */
export interface ColumnInfo {
  name: string;
  type: string;
}

export interface DatasetInfo {
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

/** Fetch the dataset insights, or null if none is loaded / the daemon is unavailable. */
export async function fetchDatasetInfo(httpBase: string): Promise<DatasetInfo | null> {
  try {
    const res = await fetch(`${httpBase}/dataset`);
    if (!res.ok) return null;
    return (await res.json()) as DatasetInfo;
  } catch {
    return null;
  }
}
