import { describe, expect, test, vi, afterEach } from "vitest";
import * as arrow from "apache-arrow";
import { runSql } from "./sql";

/** Build an Arrow IPC stream the way the daemon does (smile.io.Arrow → stream variant). */
function arrowStream(): Uint8Array {
  const table = arrow.tableFromArrays({ x: Int32Array.from([42]), y: ["hi"] });
  return arrow.tableToIPC(table, "stream");
}

function mockFetch(opts: {
  ok?: boolean;
  status?: number;
  contentType: string;
  headers?: Record<string, string>;
  body: BodyInit | object;
}) {
  const headers = new Headers({ "content-type": opts.contentType, ...(opts.headers ?? {}) });
  const res: Partial<Response> = {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers,
    arrayBuffer: async () => {
      if (opts.body instanceof Uint8Array) {
        // Return a tight ArrayBuffer copy (not the possibly-larger backing buffer).
        return opts.body.slice().buffer as ArrayBuffer;
      }
      return opts.body as ArrayBuffer;
    },
    json: async () => opts.body,
  };
  return vi.fn().mockResolvedValue(res as Response);
}

afterEach(() => vi.restoreAllMocks());

describe("runSql", () => {
  test("parses an Arrow stream SELECT result into a table with header metadata", async () => {
    const stream = arrowStream();
    vi.stubGlobal(
      "fetch",
      mockFetch({
        contentType: "application/vnd.apache.arrow.stream",
        headers: {
          "X-Smile-Rows": "1",
          "X-Smile-Cols": "2",
          "X-Smile-Elapsed-Ms": "7",
          "X-Smile-Truncated": "false",
        },
        body: stream,
      }),
    );

    const r = await runSql("http://d/api/v1", "SELECT 42 AS x, 'hi' AS y");
    expect(r.kind).toBe("query");
    if (r.kind !== "query") return;
    expect(r.rows).toBe(1);
    expect(r.cols).toBe(2);
    expect(r.elapsedMs).toBe(7);
    expect(r.truncated).toBe(false);
    expect(r.table.numRows).toBe(1);
    expect(r.table.getChild("x")?.get(0)).toBe(42);
  });

  test("parses a DDL JSON result (no grid, effect summary)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        contentType: "application/json",
        body: { kind: "ddl", ok: true, rowsAffected: null, tables: ["churn", "churn_active"] },
      }),
    );

    const r = await runSql("http://d/api/v1", "CREATE TABLE churn_active AS SELECT * FROM churn");
    expect(r.kind).toBe("ddl");
    if (r.kind === "query") return;
    expect(r.ok).toBe(true);
    expect(r.tables).toContain("churn_active");
  });

  test("throws SqlRunError carrying the daemon's message and status on a 400", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: false,
        status: 400,
        contentType: "application/json",
        body: { error: "Parser Error: syntax error at or near \"FROM\"" },
      }),
    );

    await expect(runSql("http://d/api/v1", "SELECT FROM WHERE")).rejects.toMatchObject({
      name: "SqlRunError",
      status: 400,
    });
  });

  test("sends the statement and maxRows in the POST body", async () => {
    const f = mockFetch({
      contentType: "application/vnd.apache.arrow.stream",
      body: arrowStream(),
    });
    vi.stubGlobal("fetch", f);

    await runSql("http://d/api/v1", "SELECT 1", 500);
    const [, init] = f.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ sql: "SELECT 1", maxRows: 500 });
  });
});
