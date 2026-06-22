/**
 * UAT — the daemon HTTP contract, replayed from REAL captured fixtures (no Java backend).
 * Exercises the actual frontend clients (sql.ts, datasetInfo.ts) against fixtureFetch, so a
 * client regression against the real wire shapes fails here.
 */
import { runSql, fetchTables, saveAsTable, SqlRunError } from "../daemon/sql";
import { fetchDatasetInfo } from "../daemon/datasetInfo";
import { fixtureFetch, FIXTURE_HTTP_BASE as BASE } from "./harness";

test("SELECT * returns the real titanic Arrow table (100 rows, 12 cols, Int64 ids)", async () => {
  const r = await runSql(BASE, "SELECT * FROM titanic LIMIT 100", undefined, fixtureFetch);
  expect(r.kind).toBe("query");
  if (r.kind !== "query") return;
  expect(r.rows).toBe(100);
  expect(r.cols).toBe(12);
  expect(r.truncated).toBe(false);
  expect(r.table.numRows).toBe(100);
  // the crash-domain columns: DuckDB BIGINT → Arrow Int64
  expect(String(r.table.getChild("PassengerId")?.type)).toBe("Int64");
  expect(r.table.getChild("Name")?.get(0)).toContain("Braund");
});

test("aggregate query returns its captured Arrow result", async () => {
  const r = await runSql(BASE, "SELECT Pclass, COUNT(*) AS n, AVG(Fare) AS avg_fare FROM titanic GROUP BY Pclass", undefined, fixtureFetch);
  expect(r.kind).toBe("query");
  if (r.kind !== "query") return;
  expect(r.table.numRows).toBe(3); // 3 passenger classes
  expect(r.table.schema.fields.map((f) => f.name)).toContain("Pclass");
});

test("CREATE TABLE (DDL) returns a JSON effect summary, not a grid", async () => {
  const r = await runSql(BASE, `CREATE TABLE titanic AS SELECT * FROM read_csv('input/titanic.csv', header=true)`, undefined, fixtureFetch);
  expect(r.kind).toBe("ddl");
  if (r.kind === "query") return;
  expect(r.ok).toBe(true);
  expect(r.tables).toContain("titanic");
});

test("a bad-table SELECT surfaces a 400 SqlRunError with the daemon's message", async () => {
  await expect(runSql(BASE, "SELECT * FROM no_such_table_xyz", undefined, fixtureFetch))
    .rejects.toMatchObject({ name: "SqlRunError", status: 400 });
});

test("/tables returns the captured schema rail", async () => {
  const tables = await fetchTables(BASE, fixtureFetch);
  expect(tables.length).toBeGreaterThan(0);
  const titanic = tables.find((t) => t.name === "titanic");
  expect(titanic).toBeDefined();
  expect(titanic!.columns.map((c) => c.name)).toContain("PassengerId");
});

test("fetchTables throws on a non-200 (so the rail keeps its prior list)", async () => {
  const failing: typeof fetch = async () => new Response("oops", { status: 503 });
  await expect(fetchTables(BASE, failing)).rejects.toBeInstanceOf(SqlRunError);
});

test("saveAsTable surfaces a 409 (name taken) so the UI can offer overwrite", async () => {
  await expect(saveAsTable(BASE, "taken", "SELECT 1", false, fixtureFetch))
    .rejects.toMatchObject({ status: 409 });
  // overwrite=true succeeds
  const tables = await saveAsTable(BASE, "taken", "SELECT 1", true, fixtureFetch);
  expect(tables).toContain("taken");
});

test("/dataset returns the named table's schema + preview (titanic, 891×12)", async () => {
  const info = await fetchDatasetInfo(BASE, "titanic", false, fixtureFetch);
  expect(info).not.toBeNull();
  expect(info!.fileName).toBe("titanic"); // the session-table name (new contract — not a file)
  expect(info!.nrow).toBe(891);
  expect(info!.ncol).toBe(12);
  expect(Object.keys(info!.preview)).toContain("PassengerId");
});

test("fetchDatasetInfo returns null for an unknown table (404, never throws)", async () => {
  expect(await fetchDatasetInfo(BASE, "no_such_table", false, fixtureFetch)).toBeNull();
});

test("fetchDatasetInfo returns null (never throws) on a daemon error", async () => {
  const failing: typeof fetch = async () => new Response("nope", { status: 500 });
  expect(await fetchDatasetInfo(BASE, "titanic", false, failing)).toBeNull();
});
