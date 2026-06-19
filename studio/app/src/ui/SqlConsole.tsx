/**
 * The SQL Console (SQL-driven exploration, Phase 1): a SQL editor over a result grid.
 * Every transformation is one DuckDB statement run by the daemon against the SAME session
 * the agent uses (POST /api/v1/sql) — so a table created here is queryable by Clair and
 * vice-versa. SELECT/WITH results render in the Perspective DataGrid; DDL/DML show an
 * effect summary. A status badge reports engine + latency + result shape (Count-style).
 *
 * This is the start of replacing the Perspective-pivot Explore/Data views with a
 * SQL-first surface; it is routed as a temporary "SQL" view alongside them for now.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRunContext } from "../automl/RunContext";
import { runSql, SqlRunError, type SqlResult } from "../daemon/sql";
import { DataGrid } from "./DataGrid";

export function SqlConsole({ injected }: { injected?: { sql: string; n: number } | null }) {
  const { httpBase, datasetInfo } = useRunContext();
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<SqlResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Seed a starter query when a dataset's schema is known, so a non-SQL user gets an
  // instant zero-typing preview. Keyed on fileName (not a one-shot latch) so loading a NEW
  // dataset while this view is mounted re-seeds for the new table — but only while the
  // editor still holds a prior auto-seed (never clobber what the user typed).
  const seededFor = useRef<string | null>(null);
  const lastSeed = useRef<string>("");
  useEffect(() => {
    if (!datasetInfo) return;
    if (seededFor.current === datasetInfo.fileName) return;
    const editorIsAutoSeedOrEmpty = sql === "" || sql === lastSeed.current;
    if (!editorIsAutoSeedOrEmpty) return; // user has their own query; leave it
    const seed = `SELECT * FROM ${tableNameFromFile(datasetInfo.fileName)} LIMIT 100`;
    setSql(seed);
    lastSeed.current = seed;
    seededFor.current = datasetInfo.fileName;
  }, [datasetInfo, sql]);

  // The agent's "Open in console" drops a statement into the editor (editable, not run).
  // Keyed on injected.n so re-opening the SAME statement re-fires.
  useEffect(() => {
    if (injected != null) {
      setSql(injected.sql);
      textareaRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injected?.n]);

  const run = useCallback(async () => {
    const statement = sql.trim();
    if (!statement || !httpBase || running) return;
    setRunning(true);
    setError(null);
    try {
      const r = await runSql(httpBase, statement);
      setResult(r);
    } catch (e) {
      setError(e instanceof SqlRunError ? e.message : String(e));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }, [sql, httpBase, running]);

  if (!httpBase) {
    return (
      <div className="surface">
        <div className="surface-note">
          The SQL console runs queries against your data in DuckDB — the same engine Clair
          uses, so tables you create are shared with the agent.
        </div>
        <div className="surface-empty">
          Connect the Smile daemon (configure the LLM in Settings) to run SQL.
        </div>
      </div>
    );
  }

  return (
    <div className="surface sql-console">
      <div className="sql-editor-row">
        <textarea
          ref={textareaRef}
          className="sql-editor"
          spellCheck={false}
          placeholder="SELECT * FROM …   (⌘/Ctrl-Enter to run)"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              run();
            }
          }}
        />
        <button className="sql-run primary" onClick={run} disabled={!sql.trim() || running}>
          {running ? "Running…" : "Run"}
        </button>
      </div>

      <SqlStatus result={result} error={error} running={running} />

      <div className="sql-result">
        {result?.kind === "query" ? (
          <DataGrid data={result.table} height={460} />
        ) : result ? (
          <div className="sql-effect">
            {result.ok ? "✓ Statement executed." : "Statement failed."}
            {result.rowsAffected != null && ` ${result.rowsAffected} row(s) affected.`}
            {result.tables.length > 0 && (
              <div className="sql-tables">Tables: {result.tables.join(", ")}</div>
            )}
          </div>
        ) : (
          <div className="surface-empty">Run a query to see results.</div>
        )}
      </div>
    </div>
  );
}

function SqlStatus({
  result,
  error,
  running,
}: {
  result: SqlResult | null;
  error: string | null;
  running: boolean;
}) {
  if (running) return <div className="sql-badge">DuckDB · running…</div>;
  if (error) return <div className="sql-badge bad">DuckDB · {error}</div>;
  if (result?.kind === "query") {
    return (
      <div className="sql-badge">
        DuckDB · {result.elapsedMs} ms · {result.cols} cols · {result.rows.toLocaleString()} rows
        {result.truncated && <span className="sql-trunc"> (truncated)</span>}
      </div>
    );
  }
  return <div className="sql-badge dim">DuckDB · ready</div>;
}

/** The default table name for a dataset file (file stem, hyphens→underscores) — matches
 * the ioa init skill's convention so the seeded query hits the agent-loaded table. */
function tableNameFromFile(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  return stem.replace(/[^A-Za-z0-9_]/g, "_");
}
