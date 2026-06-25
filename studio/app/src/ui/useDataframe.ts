/**
 * Fetch a dataframe artifact's rows ONCE from the daemon's /data/{ref} endpoint (column-JSON).
 * Shared by the dataframe canvas branch so Predictions Studio and the Data Grid render from a
 * SINGLE fetch rather than each issuing its own (which double-hit the shared DuckDB connection).
 */
import { useEffect, useState } from "react";
import { useRunContext } from "../store/RunContext";
import type { ColumnTable } from "../lib/dataFrame";

export type DataframeState =
  | { status: "loading" }
  | { status: "ready"; table: ColumnTable }
  | { status: "failed" };

export function useDataframe(ref: string | undefined): DataframeState {
  const { httpBase } = useRunContext();
  const [state, setState] = useState<DataframeState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    if (!httpBase || !ref) {
      setState({ status: "failed" });
      return;
    }
    fetch(`${httpBase}/data/${encodeURIComponent(ref)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: ColumnTable | null) => {
        if (cancelled) return;
        setState(json ? { status: "ready", table: json } : { status: "failed" });
      })
      .catch(() => { if (!cancelled) setState({ status: "failed" }); });
    return () => { cancelled = true; };
  }, [httpBase, ref]);

  return state;
}
