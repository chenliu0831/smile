/**
 * Replay-fixture test harness (task #81). Drives the WHOLE frontend — real reducer, real
 * RunConnection interface, real SQL/dataset clients — against REAL daemon payloads captured
 * into src/daemon/mock/fixtures/, with NO Java backend and NO socket. This is the high-
 * fidelity, fast substitute for the live daemon that the integration tests build on.
 *
 * Two injection seams (both default to production behavior, so nothing else changes):
 *  - `fixtureConnect`: a `connectRun`-shaped factory returning a MockRunPlayer that streams
 *    the captured /ws/run transcript (ws-summarize.jsonl). Pass to <RunProvider connect=…>.
 *  - `fixtureFetch`: a `fetch`-shaped stub that answers /sql, /sql/save, /tables, /dataset,
 *    /data/{ref} from the captured HTTP fixtures (Arrow bytes + headers, JSON bodies).
 *
 * Fixtures were captured from a live agent-mode daemon (real Bedrock) — see the
 * `test(fixtures)` commit. They carry the real wire shapes: Arrow STREAM IPC bytes with
 * Int64/Float64/Utf8 titanic columns, X-Smile-* headers, SMILE vs DuckDB type vocabularies,
 * and a 42-frame summarize transcript with tool-calls + artifacts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MockRunPlayer, type PlayerOptions } from "../daemon/mock/player";
import type { RunConnectionResult } from "../daemon/connect";
import type { DaemonMessage } from "../daemon/protocol";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "daemon", "mock", "fixtures");

const readFix = (name: string) => readFileSync(join(FIX, name));
const readJson = (name: string) => JSON.parse(readFix(name).toString("utf8"));

/** Parse the captured /ws/run transcript (one JSON DaemonMessage per line) into a script. */
export function loadWsScript(file = "ws-summarize.jsonl"): DaemonMessage[] {
  return readFix(file)
    .toString("utf8")
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as DaemonMessage);
}

/**
 * The greeting the captured transcript opens with, if any (the first session-started frame's
 * greeting), so the replay matches what the live daemon emitted.
 */
function scriptGreeting(script: DaemonMessage[]): string | undefined {
  const first = script.find((m) => m.type === "session-started");
  return first && "greeting" in first ? (first.greeting as string | undefined) : undefined;
}

/**
 * A `connectRun`-shaped factory backed by the captured WS transcript. The returned
 * MockRunPlayer streams the real frames (pausing at any gate until answered). `stepMs: 0`
 * makes the player drain synchronously via flush() — deterministic for tests.
 *
 * NOTE the captured transcript already contains its own leading `session-started` frame, so
 * we strip the player's synthetic greeting frame by replaying the captured frames verbatim:
 * the player emits its own session-started on start(), then pumps the script. To avoid a
 * duplicate, we drop the transcript's leading session-started and let the player emit it.
 */
export function fixtureConnect(
  opts: { file?: string; player?: PlayerOptions; httpBase?: string } = {},
): typeof import("../daemon/connect").connectRun {
  const full = loadWsScript(opts.file);
  // Drop the leading session-started (the player emits its own on start()).
  const script = full[0]?.type === "session-started" ? full.slice(1) : full;
  const greeting = scriptGreeting(full);
  const connect = async (): Promise<RunConnectionResult> => {
    const player = new MockRunPlayer(script, { stepMs: 0, greeting, ...(opts.player ?? {}) });
    // The replay player has no real daemon; tests that exercise the HTTP path (addData,
    // SQL) can supply a base so the controller takes the warm in-session path.
    if (opts.httpBase) {
      (player as unknown as { httpBase: () => string | null }).httpBase = () => opts.httpBase!;
    }
    return { connection: player, mode: "daemon" };
  };
  // connectRun's signature is (stepMs?, workingDir?) => Promise<RunConnectionResult>; the
  // harness ignores both args. Cast to the exact type for the injection seam.
  return connect as unknown as typeof import("../daemon/connect").connectRun;
}

/** Build a `Response` for captured Arrow query bytes + its sidecar `.headers.json`. */
function arrowResponse(base: string): Response {
  const buf = readFix(`${base}.arrow`);
  const meta = readJson(`${base}.headers.json`);
  const h = meta.headers ?? {};
  const headers = new Headers();
  headers.set("content-type", h["content-type"] ?? "application/vnd.apache.arrow.stream");
  for (const k of ["x-smile-rows", "x-smile-cols", "x-smile-elapsed-ms", "x-smile-truncated"]) {
    if (h[k] != null) headers.set(k, String(h[k]));
  }
  // Response copies the bytes; pass a fresh ArrayBuffer slice.
  return new Response(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), {
    status: meta.status ?? 200,
    headers,
  });
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * Map a SELECT statement to the captured Arrow fixture that answers it (by content), or null
 * if the query references a table the fixtures don't know about — the daemon would return a
 * 400 {error} for an unknown table, so the harness must too (rather than handing back a wrong
 * Arrow table and letting a broken error path pass silently).
 */
function arrowFixtureFor(sql: string): string | null {
  const s = sql.toLowerCase();
  if (/group by\s+pclass/.test(s)) return "sql-groupby";
  if (/avg\(survived\)/.test(s) || /group by\s+sex/.test(s)) return "sql-survival";
  if (/passengerid.*order by\s+fare/.test(s)) return "sql-bigids";
  // Known data sources in the fixtures: the `titanic` table and direct read_csv/parquet/json.
  if (/\btitanic\b/.test(s) || /read_(csv|parquet|json)\s*\(/.test(s)) return "sql-select-all";
  return null; // unknown table/source → caller returns the captured 400
}

/**
 * A `fetch`-shaped stub answering the daemon HTTP contract from captured fixtures. Routes by
 * URL path + (for /sql) the SQL keyword, mirroring the daemon's server-side routing:
 *  - POST /sql  SELECT/WITH/… → Arrow stream bytes; DDL/DML → JSON effect; unknown table → 400
 *  - POST /sql/save → save effect (or 409 if name === "taken")
 *  - GET  /tables  → captured tables.json
 *  - GET  /dataset → captured dataset-titanic.json
 *  - GET  /data/{ref} → captured data-<ref>.json (else 404)
 */
export const fixtureFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const path = new URL(url, "http://x").pathname;
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) : {};

  if (path.endsWith("/sql/save")) {
    if (body.name === "taken" && !body.overwrite) {
      return jsonResponse({ error: `A table named '${body.name}' already exists.` }, 409);
    }
    return jsonResponse({ kind: "save", ok: true, rowsAffected: null, tables: [body.name] });
  }

  if (path.endsWith("/sql") && method === "POST") {
    const sql = String(body.sql ?? "");
    const kw = sql.trim().toLowerCase();
    const isQuery = /^(select|with|from|table|values|pivot|unpivot|describe|show|summarize)\b/.test(kw);
    if (isQuery) {
      // A query against a table the fixtures don't know → 400 {error}, exactly as the real
      // daemon does for an unknown table (so a broken UI error path can't pass silently).
      const fixture = arrowFixtureFor(sql);
      if (fixture === null) return jsonResponse(readJson("sql-error.json").body, 400);
      return arrowResponse(fixture);
    }
    if (/^(insert|update|delete)\b/.test(kw)) {
      return jsonResponse({ kind: "dml", ok: true, rowsAffected: 1, tables: [] });
    }
    // DDL (CREATE/DROP/…): the captured create effect.
    return jsonResponse(readJson("sql-create.json").body ?? { kind: "ddl", ok: true, rowsAffected: null, tables: ["titanic"] });
  }

  if (path.endsWith("/tables")) return jsonResponse(readJson("tables.json"));
  if (path.endsWith("/dataset")) return jsonResponse(readJson("dataset-titanic.json"));

  const dataMatch = path.match(/\/data\/([^/?]+)$/);
  if (dataMatch) {
    const ref = dataMatch[1];
    try {
      return jsonResponse(readJson(`data-${ref}.json`));
    } catch {
      return jsonResponse({ error: `Unknown data ref: ${ref}` }, 404);
    }
  }

  return jsonResponse({ error: `unmapped fixture route: ${method} ${path}` }, 404);
}) as typeof fetch;

/** Convenience: the daemon HTTP base the fixtureFetch answers (any host works). */
export const FIXTURE_HTTP_BASE = "http://127.0.0.1:0/api/v1";
