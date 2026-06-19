/**
 * The SQL Console (SQL-driven exploration): a schema rail + SQL editor over a result grid.
 * Every transformation is one DuckDB statement run by the daemon against the SAME session
 * the agent uses (POST /api/v1/sql) — so a table created here is queryable by Clair and
 * vice-versa. SELECT/WITH results render in the Perspective DataGrid; DDL/DML show an effect
 * summary; "Save as table" materializes the current query as a real, chainable table.
 *
 * Phase 2: this is the single data surface (replaces the old DataPanel/DataExplorer). The
 * left rail lists every shared-session table with its columns + lineage (click to insert).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRunContext } from "../automl/RunContext";
import {
  runSql,
  saveAsTable,
  fetchTables,
  SqlRunError,
  type SqlResult,
  type TableInfo,
} from "../daemon/sql";
import { DataGrid } from "./DataGrid";

export function SqlConsole({ injected }: { injected?: { sql: string; n: number } | null }) {
  const { httpBase, datasetInfo, state } = useRunContext();
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<SqlResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const refreshTables = useCallback(() => {
    if (httpBase) fetchTables(httpBase).then(setTables).catch(() => setTables([]));
  }, [httpBase]);

  // Load the table list on mount / daemon change.
  useEffect(() => {
    refreshTables();
  }, [refreshTables]);

  // The agent shares this DuckDB session — when it finishes a turn it may have created or
  // loaded tables (its init/preprocess skills do). Refresh the rail on each agent turn
  // boundary (and tool-call count change) so agent-created tables appear without a manual
  // action. Cheap: /tables is a fast metadata read.
  const agentActivity = `${state.turns.length}:${state.streaming}:${
    state.turns.reduce((acc, t) => acc + t.toolCalls.length, 0)
  }`;
  useEffect(() => {
    refreshTables();
  }, [agentActivity, refreshTables]);

  // Seed a starter query when a dataset is present, so a non-SQL user gets an instant
  // zero-typing preview. Conflict-free: read the input file directly via read_csv/parquet/
  // json (creates NO table, so it never collides with the agent's `SQL load`). Keyed on
  // fileName so loading a NEW dataset re-seeds — but only while the editor still holds a
  // prior auto-seed (never clobber what the user typed).
  const seededFor = useRef<string | null>(null);
  const lastSeed = useRef<string>("");
  useEffect(() => {
    if (!datasetInfo) return;
    if (seededFor.current === datasetInfo.fileName) return;
    const editorIsAutoSeedOrEmpty = sql === "" || sql === lastSeed.current;
    if (!editorIsAutoSeedOrEmpty) return;
    const seed = seedQuery(datasetInfo.fileName);
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
      // A DDL/DML statement may have changed the table set; refresh the rail.
      if (r.kind !== "query") refreshTables();
    } catch (e) {
      setError(e instanceof SqlRunError ? e.message : String(e));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }, [sql, httpBase, running, refreshTables]);

  const save = useCallback(async () => {
    const select = sql.trim();
    if (!select || !httpBase || running) return;
    const raw = window.prompt("Save query result as table named:");
    const name = raw?.trim();
    if (!name) return;
    setRunning(true);
    setError(null);
    setSavedNotice(null);
    try {
      try {
        await saveAsTable(httpBase, name, select);
      } catch (e) {
        // 409 = name taken. Offer to overwrite rather than silently clobbering.
        if (e instanceof SqlRunError && e.status === 409) {
          if (!window.confirm(`A table named "${name}" already exists. Overwrite it?`)) {
            setRunning(false);
            return;
          }
          await saveAsTable(httpBase, name, select, true);
        } else {
          throw e;
        }
      }
      refreshTables();
      // Show the saved table so "Save as table" produces visible feedback (#4).
      const preview = await runSql(httpBase, `SELECT * FROM "${name}"`);
      setResult(preview);
      setSavedNotice(`Saved as “${name}”.`);
    } catch (e) {
      setError(e instanceof SqlRunError ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [sql, httpBase, running, refreshTables]);

  const insert = useCallback((text: string) => {
    setSql((prev) => (prev.trim() ? `${prev} ${text}` : text));
    textareaRef.current?.focus();
  }, []);

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

  // A SELECT/WITH (or FROM-first) statement can be saved as a table.
  const canSave = /^\s*(select|with|from|table|values)\b/i.test(sql);

  return (
    <div className="sql-workbench">
      <SchemaRail tables={tables} onInsert={insert} />
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
          <div className="sql-actions">
            <button className="sql-run primary" onClick={run} disabled={!sql.trim() || running}>
              {running ? "Running…" : "Run"}
            </button>
            <button className="sql-save" onClick={save} disabled={!canSave || running} title="Save the query result as a reusable table">
              Save as table
            </button>
          </div>
        </div>

        <SqlStatus result={result} error={error} running={running} savedNotice={savedNotice} />

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
    </div>
  );
}

/** Left schema rail: tables/views with columns + lineage; click to insert names. */
function SchemaRail({ tables, onInsert }: { tables: TableInfo[]; onInsert: (text: string) => void }) {
  return (
    <div className="schema-rail">
      <div className="schema-rail-title">Tables</div>
      {tables.length === 0 ? (
        <div className="schema-rail-empty">
          No tables yet. Query the input file directly, or ask Clair to load it.
        </div>
      ) : (
        tables.map((t) => (
          <details key={t.name} className="schema-table" open>
            <summary>
              <button className="schema-name" onClick={() => onInsert(t.name)} title="Insert table name">
                {t.name}
              </button>
            </summary>
            {t.definition && (
              <div className="schema-def" title={t.definition}>↳ {t.definition}</div>
            )}
            <ul className="schema-cols">
              {t.columns.map((c) => (
                <li key={c.name}>
                  <button className="schema-col" onClick={() => onInsert(c.name)} title={`Insert ${c.name}`}>
                    {c.name}
                  </button>
                  <em>{c.type}</em>
                </li>
              ))}
            </ul>
          </details>
        ))
      )}
    </div>
  );
}

function SqlStatus({
  result,
  error,
  running,
  savedNotice,
}: {
  result: SqlResult | null;
  error: string | null;
  running: boolean;
  savedNotice: string | null;
}) {
  if (running) return <div className="sql-badge">DuckDB · running…</div>;
  if (error) return <div className="sql-badge bad">DuckDB · {error}</div>;
  if (savedNotice) return <div className="sql-badge good">DuckDB · {savedNotice}</div>;
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

/**
 * A conflict-free seed query: reads the input file directly via the right DuckDB reader,
 * creating no table (so it never collides with the agent's `SQL load`, which CREATEs a
 * table of the same stem). The agent's loaded table, once present, shows up in the rail.
 */
function seedQuery(fileName: string): string {
  const lower = fileName.toLowerCase();
  const path = `input/${fileName}`;
  if (lower.endsWith(".parquet")) return `SELECT * FROM read_parquet('${path}') LIMIT 100`;
  if (lower.endsWith(".json") || lower.endsWith(".jsonl")) return `SELECT * FROM read_json('${path}') LIMIT 100`;
  if (lower.endsWith(".tsv")) return `SELECT * FROM read_csv('${path}', delim='\\t', header=true) LIMIT 100`;
  // CSV and everything else: read_csv with header inference.
  return `SELECT * FROM read_csv('${path}', header=true) LIMIT 100`;
}
