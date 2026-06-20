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
import { agentSqlStatements, freshAgentSql } from "./agentSql";

/** Statements that return a result set we can render in the grid. */
const QUERY_SHAPE = /^\s*(select|with|from|table|values|pivot|unpivot|describe|show|summarize)\b/i;

export function SqlConsole({ injected }: { injected?: { sql: string; n: number } | null }) {
  const { httpBase, datasetInfo, state, sendMessage } = useRunContext();
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<SqlResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  // Phase 3 — "Ask Clair"/"Fix": when true, the next agent-produced SQL statement is
  // injected into the editor. Records the count of agent SQL tool-calls at request time so
  // we only react to a NEW one (not a stale prior statement).
  const [awaitingAgentSql, setAwaitingAgentSql] = useState(false);
  const agentSqlBaselineRef = useRef(0);   // agent SQL count when the request was sent
  const agentTurnBaselineRef = useRef(0);  // turn count when the request was sent
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The SELECT-shape statement whose result is currently in the grid (NOT the live editor
  // text, which the user may have edited). This is what we re-run to keep the grid current
  // when the underlying table is mutated by the user's own DML or by the agent.
  const lastQueryRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  // Set when an agent-activity refresh is wanted but a user run is in flight; the run's
  // finally drains it so a refresh requested mid-run is never lost.
  const pendingRefreshRef = useRef(false);

  // Refresh the schema rail. Awaitable so callers (save/run) can sequence the rail update.
  // fetchTables THROWS on a transient daemon hiccup (the /tables call does N+1 serialized
  // queries behind the shared SQL lock), so a successful fetch is authoritative — including
  // an empty list (the user dropped the last table). Only a throw keeps the prior list.
  const refreshTables = useCallback(async () => {
    if (!httpBase) return;
    try {
      setTables(await fetchTables(httpBase));
    } catch {
      /* transient failure — keep the current list rather than wiping the rail */
    }
  }, [httpBase]);

  /**
   * Runs a result-returning statement and reflects it in the grid, tracking it as the
   * current query so we can auto-refresh it later. `silent` (used by auto-refresh) avoids
   * the spinner/blanking the grid while the agent works. If the tracked table was dropped
   * or renamed (catalog error), shows a purpose-built message instead of a raw DuckDB error
   * and stops tracking it so we don't keep re-running a dead query.
   */
  const runSelect = useCallback(async (statement: string, opts?: { silent?: boolean }) => {
    if (!httpBase) return;
    const silent = opts?.silent ?? false;
    if (!silent) {
      setRunning(true); runningRef.current = true;
      // Only a user-initiated run clears the prior error/notice. A silent auto-refresh
      // (agent tick) must NOT wipe the user's "Saved as table" notice or last error.
      setError(null);
      setSavedNotice(null);
    }
    try {
      const r = await runSql(httpBase, statement);
      setResult(r);
      lastQueryRef.current = QUERY_SHAPE.test(statement) ? statement : lastQueryRef.current;
    } catch (e) {
      const msg = e instanceof SqlRunError ? e.message : String(e);
      // The table backing the tracked query was removed/renamed (likely by Clair).
      if (/does not exist|not found|catalog/i.test(msg)) {
        lastQueryRef.current = null;
        setResult(null);
        setError("The table you were viewing was dropped or renamed. Run a new query.");
      } else if (!silent) {
        setError(msg);
        setResult(null);
      }
      // On a silent (auto) refresh of a non-catalog error, keep the prior result rather
      // than blanking what the user is looking at.
    } finally {
      if (!silent) { setRunning(false); runningRef.current = false; }
    }
  }, [httpBase]);

  // Drains a refresh requested by an agent tick while a user run() / save() was in flight,
  // so a transformation that landed mid-run is still reflected once the run completes.
  const drainPendingRefresh = useCallback(() => {
    if (pendingRefreshRef.current && lastQueryRef.current && !runningRef.current) {
      pendingRefreshRef.current = false;
      runSelect(lastQueryRef.current, { silent: true });
    }
  }, [runSelect]);

  // Load the table list on mount / daemon change.
  useEffect(() => {
    refreshTables();
  }, [refreshTables]);

  // The agent shares this DuckDB session — a finished turn may have created/loaded/mutated
  // tables (init/preprocess/feature-engineering skills do). On each agent turn boundary:
  // (1) refresh the schema rail, and (2) auto re-run the tracked query so the result grid
  // reflects the agent's transformation without a manual action (user chose auto-refresh).
  const agentActivity = `${state.turns.length}:${state.streaming}:${
    state.turns.reduce((acc, t) => acc + t.toolCalls.length, 0)
  }`;
  useEffect(() => {
    refreshTables();
    if (lastQueryRef.current) {
      // If a user run is in flight, defer (the run's finally drains it) so the refresh is
      // never dropped — the turn-finished tick may land mid-run with no later tick to retry.
      if (!runningRef.current) runSelect(lastQueryRef.current, { silent: true });
      else pendingRefreshRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentActivity]);

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

  // All SQL statements the agent has produced this session (kind="sql" tool-call code).
  const sqlStatements = agentSqlStatements(state.turns);

  // Phase 3: when an "Ask Clair"/"Fix" request is outstanding, inject the agent's resulting
  // SQL once the turn we triggered FINISHES (not mid-stream): the agent often runs an
  // exploratory DESCRIBE/SELECT before the real statement, so we wait for the turn to end
  // and inject the LAST new statement. If the turn ends with no new SQL at all (the agent
  // replied with prose or a clarifying question), clear the wait so Ask/Fix don't stick.
  useEffect(() => {
    if (!awaitingAgentSql) return;
    const turnInFlight = state.streaming || state.openGates.length > 0;
    const ourTurnEnded = !turnInFlight && state.turns.length > agentTurnBaselineRef.current;
    if (!ourTurnEnded) return; // still waiting for the turn we triggered to complete
    const fresh = freshAgentSql(sqlStatements, agentSqlBaselineRef.current, "last");
    if (fresh != null) {
      setSql(fresh);
      textareaRef.current?.focus();
    }
    setAwaitingAgentSql(false); // reset whether or not the agent produced SQL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingAgentSql, state.streaming, state.openGates.length, state.turns.length, sqlStatements.length]);

  // Send a prompt to Clair and arm injection of its resulting SQL back into the editor.
  const askClair = useCallback((prompt: string) => {
    if (state.streaming || state.openGates.length > 0) return; // chat busy; UI also disables
    agentSqlBaselineRef.current = sqlStatements.length;
    agentTurnBaselineRef.current = state.turns.length;
    setAwaitingAgentSql(true);
    sendMessage(prompt);
  }, [sendMessage, state.streaming, state.openGates.length, state.turns.length, sqlStatements.length]);

  const run = useCallback(async () => {
    const statement = sql.trim();
    if (!statement || !httpBase || running) return;
    // A result-returning statement renders + becomes the tracked query.
    if (QUERY_SHAPE.test(statement)) {
      await runSelect(statement);
      drainPendingRefresh();
      return;
    }
    // A DDL/DML statement: run it, refresh the rail, then re-run the tracked query so the
    // grid shows the POST-mutation data instead of being blanked to an effect summary. If
    // nothing is tracked yet, fall back to showing the effect result.
    setRunning(true); runningRef.current = true;
    setError(null);
    try {
      const r = await runSql(httpBase, statement);
      refreshTables();
      if (lastQueryRef.current) {
        await runSelect(lastQueryRef.current, { silent: true });
      } else {
        setResult(r);
      }
    } catch (e) {
      setError(e instanceof SqlRunError ? e.message : String(e));
      setResult(null);
    } finally {
      setRunning(false); runningRef.current = false;
      drainPendingRefresh();
    }
  }, [sql, httpBase, running, refreshTables, runSelect, drainPendingRefresh]);

  const save = useCallback(async () => {
    const select = sql.trim();
    if (!select || !httpBase || running) return;
    const raw = window.prompt("Save query result as table named:");
    const name = raw?.trim();
    if (!name) return;
    setRunning(true); runningRef.current = true;
    setError(null);
    setSavedNotice(null);
    try {
      try {
        await saveAsTable(httpBase, name, select);
      } catch (e) {
        // 409 = name taken. Offer to overwrite rather than silently clobbering.
        if (e instanceof SqlRunError && e.status === 409) {
          if (!window.confirm(`A table named "${name}" already exists. Overwrite it?`)) {
            setRunning(false); runningRef.current = false;
            return;
          }
          await saveAsTable(httpBase, name, select, true);
        } else {
          throw e;
        }
      }
      // Await the rail refresh so the just-saved table appears immediately (not racing the
      // subsequent re-renders).
      await refreshTables();
      // Show the saved table (becomes the tracked query so it auto-refreshes too).
      await runSelect(`SELECT * FROM "${name}"`, { silent: true });
      setSavedNotice(`Saved as “${name}”.`);
    } catch (e) {
      setError(e instanceof SqlRunError ? e.message : String(e));
    } finally {
      setRunning(false); runningRef.current = false;
      drainPendingRefresh();
    }
  }, [sql, httpBase, running, refreshTables, runSelect, drainPendingRefresh]);

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
  // Clair handles one turn at a time; disable Ask/Fix while a turn streams or a gate is open.
  const chatBusy = state.streaming || state.openGates.length > 0 || awaitingAgentSql;

  const onAsk = () => {
    const ask = window.prompt(
      "Ask Clair to write SQL (it lands in the editor):",
      sql.trim() ? "Refine this query: " : "",
    );
    const q = ask?.trim();
    if (!q) return;
    // Give the agent the current editor SQL + the table list as context so it returns ONE
    // runnable statement, which the injection effect drops back into the editor.
    const ctx = sql.trim() ? `\n\nCurrent query in my editor:\n${sql.trim()}` : "";
    askClair(
      `In the SQL console I want: ${q}.${ctx}\n\nReply by running ONE DuckDB SQL statement via your SQL tool ` +
        `(the 'execute' command) against the available tables, so it appears in my editor. Keep it to a single statement.`,
    );
  };

  const onFix = () => {
    if (!error) return;
    askClair(
      `My SQL failed. Statement:\n${sql.trim()}\n\nError:\n${error}\n\n` +
        `Fix it and run the corrected single DuckDB statement via your SQL tool ('execute') so it appears in my editor.`,
    );
  };

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
            <button className="sql-ask" onClick={onAsk} disabled={chatBusy} title="Describe what you want in plain English; Clair writes the SQL into the editor">
              {awaitingAgentSql ? "Asking Clair…" : "✦ Ask Clair"}
            </button>
            {error && (
              <button className="sql-fix" onClick={onFix} disabled={chatBusy} title="Ask Clair to fix the SQL error">
                ✦ Fix with Clair
              </button>
            )}
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
