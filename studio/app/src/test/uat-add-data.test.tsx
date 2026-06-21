/**
 * UAT — the consolidated "Add data" flow (task #82). Verifies the single addData() action:
 * picks a file, stages it into the RUNNING daemon (no restart), imports it as a session
 * table via /sql, and re-fetches datasetInfo so the UI chip lights up — all without the
 * heavy JVM-restart load path. The redundant import/load entry points now share this.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, beforeEach, test, expect } from "vitest";

// Mock the Tauri-backed dataset module (no desktop shell in jsdom) and the SQL/dataset
// clients so we assert the orchestration, not the wire.
const pickDatasetFile = vi.fn();
const stageDataset = vi.fn();
const runSql = vi.fn();
const fetchDatasetInfo = vi.fn();

vi.mock("../daemon/dataset", () => ({
  pickDatasetFile: (...a: unknown[]) => pickDatasetFile(...a),
  stageDataset: (...a: unknown[]) => stageDataset(...a),
  pickAndLoadDataset: vi.fn(),
  canLoadDataset: () => true,
  tableNameForPath: (p: string) => p.split("/").pop()!.replace(/\.[^.]+$/, ""),
  readerForPath: (p: string) => `read_csv('${p}', header=true)`,
}));
vi.mock("../daemon/sql", async (orig) => ({ ...(await orig<typeof import("../daemon/sql")>()), runSql: (...a: unknown[]) => runSql(...a) }));
vi.mock("../daemon/datasetInfo", async (orig) => ({ ...(await orig<typeof import("../daemon/datasetInfo")>()), fetchDatasetInfo: (...a: unknown[]) => fetchDatasetInfo(...a) }));

import { useRun } from "../store/useRun";
import { SqlRunError } from "../daemon/sql";
import { fixtureConnect } from "./harness";

beforeEach(() => {
  pickDatasetFile.mockReset();
  stageDataset.mockReset();
  runSql.mockReset();
  fetchDatasetInfo.mockReset();
});

test("addData stages into the running daemon, imports as a table, and refreshes the chip", async () => {
  pickDatasetFile.mockResolvedValue("/data/customers.csv");
  stageDataset.mockResolvedValue("customers.csv");
  runSql.mockResolvedValue({ kind: "ddl", ok: true, rowsAffected: null, tables: ["customers"] });
  fetchDatasetInfo
    .mockResolvedValueOnce(null) // initial connect fetch (no dataset yet)
    .mockResolvedValueOnce({ fileName: "customers.csv", nrow: 240, ncol: 7, columns: [], preview: {} });

  const { result } = renderHook(() => useRun(fixtureConnect({ httpBase: "http://127.0.0.1:0/api/v1" })));
  // wait for the fixture connection to attach an httpBase
  await waitFor(() => expect(result.current.httpBase).not.toBeNull());

  let imported: string | null = null;
  await act(async () => { imported = await result.current.addData(); });

  expect(imported).toBe("customers");
  // staged into the live daemon (no restart) so the agent can read ./input/customers.csv
  expect(stageDataset).toHaveBeenCalledWith("/data/customers.csv");
  // fast in-session import — NON-destructive plain CREATE TABLE (not CREATE OR REPLACE)
  expect(runSql).toHaveBeenCalledWith(
    result.current.httpBase,
    expect.stringMatching(/^create table "customers" as select \* from read_csv/i),
  );
  // chip lights up via a re-fetch (no JVM restart)
  await waitFor(() => expect(result.current.datasetInfo?.fileName).toBe("customers.csv"));
});

test("addData disambiguates with a suffix instead of clobbering an existing table", async () => {
  pickDatasetFile.mockResolvedValue("/data/customers.csv");
  stageDataset.mockResolvedValue("customers.csv");
  // first CREATE collides (e.g. Clair already made a 'customers' table), second succeeds
  runSql
    .mockRejectedValueOnce(new SqlRunError("Table with name customers already exists!", 400))
    .mockResolvedValueOnce({ kind: "ddl", ok: true, rowsAffected: null, tables: ["customers", "customers_2"] });
  fetchDatasetInfo.mockResolvedValue(null);

  const { result } = renderHook(() => useRun(fixtureConnect({ httpBase: "http://127.0.0.1:0/api/v1" })));
  await waitFor(() => expect(result.current.httpBase).not.toBeNull());

  let imported: string | null = null;
  await act(async () => { imported = await result.current.addData(); });

  expect(imported).toBe("customers_2"); // did NOT clobber 'customers'
  expect(runSql).toHaveBeenNthCalledWith(1, expect.any(String), expect.stringMatching(/create table "customers" /i));
  expect(runSql).toHaveBeenNthCalledWith(2, expect.any(String), expect.stringMatching(/create table "customers_2" /i));
});

test("addData returns null and does nothing when the picker is cancelled", async () => {
  pickDatasetFile.mockResolvedValue(null);
  fetchDatasetInfo.mockResolvedValue(null);

  const { result } = renderHook(() => useRun(fixtureConnect({ httpBase: "http://127.0.0.1:0/api/v1" })));
  await waitFor(() => expect(result.current.httpBase).not.toBeNull());

  let r: string | null = "x";
  await act(async () => { r = await result.current.addData(); });
  expect(r).toBeNull();
  expect(runSql).not.toHaveBeenCalled();
  expect(stageDataset).not.toHaveBeenCalled();
});

test("addData survives a staging failure (best-effort) and still imports the table", async () => {
  pickDatasetFile.mockResolvedValue("/data/customers.csv");
  stageDataset.mockRejectedValue(new Error("no running daemon to stage into"));
  runSql.mockResolvedValue({ kind: "ddl", ok: true, rowsAffected: null, tables: ["customers"] });
  fetchDatasetInfo.mockResolvedValue(null);

  const { result } = renderHook(() => useRun(fixtureConnect({ httpBase: "http://127.0.0.1:0/api/v1" })));
  await waitFor(() => expect(result.current.httpBase).not.toBeNull());

  let imported: string | null = null;
  await act(async () => { imported = await result.current.addData(); });
  expect(imported).toBe("customers"); // staging is best-effort; the table import still ran
  expect(runSql).toHaveBeenCalled();
});
