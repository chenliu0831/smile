import { StrictMode } from "react";
import { render } from "@testing-library/react";
import * as arrow from "apache-arrow";
import { tableFromIPC } from "apache-arrow";
import { DataGrid, columnsToArrow, toArrowIPC, toPerspectiveData } from "./DataGrid";

const SAMPLE = {
  columns: ["#", "Candidate", "AUC", "Std (CV)", "Notes"],
  rows: [
    { "#": 1, Candidate: "candidate_lgbm", AUC: 0.913, "Std (CV)": 0.008, Notes: "gbm" },
    { "#": 2, Candidate: "candidate_rf", AUC: 0.881, "Std (CV)": 0.011, Notes: null },
  ],
};

// jsdom has no WebAssembly engine, so the Perspective grid never paints here. These
// tests exercise the WASM-free Arrow Frame transform layer plus a non-throwing mount.

test("columnsToArrow builds an Arrow table preserving columns, rows and values", () => {
  const table = columnsToArrow(SAMPLE);
  expect(table.numRows).toBe(2);
  expect(table.schema.fields.map((f) => f.name)).toEqual(SAMPLE.columns);
  expect(table.getChild("Candidate")?.get(0)).toBe("candidate_lgbm");
  expect(table.getChild("AUC")?.get(0)).toBeCloseTo(0.913);
});

test("toArrowIPC produces an Arrow Frame that round-trips back to the same data", () => {
  const ipc = toArrowIPC(SAMPLE);
  expect(ipc.byteLength).toBeGreaterThan(0);
  const decoded = tableFromIPC(ipc);
  expect(decoded.numRows).toBe(2);
  expect(decoded.getChild("Candidate")?.get(1)).toBe("candidate_rf");
});

test("toPerspectiveData maps columns+rows to an explicit schema with safe JS values", () => {
  const { schema, rows } = toPerspectiveData(SAMPLE);
  // Plain JS numbers infer to Arrow Float64 → "float" (columnsToArrow can't know "#"
  // is a logical integer). Strings → "string"; nulls don't change the inferred type.
  expect(schema).toEqual({
    "#": "float",
    Candidate: "string",
    AUC: "float",
    "Std (CV)": "float",
    Notes: "string",
  });
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ Candidate: "candidate_lgbm", AUC: 0.913 });
  expect(rows[1].Notes).toBeNull();
});

// The crux of the "null pointer passed to rust" fix: DuckDB BIGINT → Arrow Int64 → JS
// BigInt, which Perspective's WASM rejects. toPerspectiveData must declare such columns
// "float" and emit plain numbers (no BigInt) so Perspective ingests them reliably.
test("toPerspectiveData downcasts Arrow Int64 (BigInt) columns to float numbers", () => {
  const table = arrow.tableFromArrays({
    PassengerId: BigInt64Array.from([1n, 2n, 3n].map(BigInt)),
    Fare: Float64Array.from([7.25, 71.28, 8.05]),
  });
  // sanity: the raw Arrow cell is a BigInt (the thing Perspective chokes on)
  expect(typeof table.getChild("PassengerId")?.get(0)).toBe("bigint");

  const { schema, rows } = toPerspectiveData(table);
  expect(schema.PassengerId).toBe("float");
  expect(schema.Fare).toBe("float");
  for (const r of rows) {
    expect(typeof r.PassengerId).toBe("number");
    expect(typeof r.PassengerId).not.toBe("bigint");
  }
  expect(rows.map((r) => r.PassengerId)).toEqual([1, 2, 3]);
});

test("DataGrid mounts without throwing given a small dataset", () => {
  const { container } = render(<DataGrid data={SAMPLE} />);
  expect(container.querySelector("perspective-viewer")).toBeInTheDocument();
});

// Regression for the "null pointer passed to rust" crash (task #79): the <perspective-viewer>
// is a SINGLE persistent WASM element reused across data-prop changes. The old effect deleted
// the viewer in cleanup unawaited, racing the next render's load() under rapid churn (the
// summarize auto-refresh re-runs the tracked query on every agent tool-call tick), freeing the
// shared model pointer mid-use. The fix serializes viewer ops through one promise chain gated
// by a generation counter and never deletes the viewer on a data change. WASM doesn't paint in
// jsdom, but this asserts the React lifecycle contract: rapid re-renders + unmount never throw.
test("DataGrid survives rapid data-prop churn and unmount without throwing", () => {
  const variants = [
    SAMPLE,
    { columns: ["a", "b"], rows: [{ a: 1, b: "x" }, { a: 2, b: "y" }] },
    { columns: ["only"], rows: [{ only: 42 }] },
    columnsToArrow(SAMPLE),
  ];
  const { rerender, unmount, container } = render(<DataGrid data={variants[0]} />);
  // Churn the prop faster than any async load could settle — the generation gate must make
  // every superseded render no-op rather than touch a freed viewer.
  for (let i = 1; i <= 12; i++) {
    rerender(<DataGrid data={variants[i % variants.length]} />);
  }
  expect(container.querySelector("perspective-viewer")).toBeInTheDocument();
  // Unmount mid-churn must enqueue teardown at the chain tail, not throw synchronously.
  expect(() => unmount()).not.toThrow();
});

// StrictMode (dev) runs setup→cleanup→setup on the SAME mounted node. The viewer-disposal
// teardown must NOT fire on that simulated unmount (it would free the live viewer's WASM
// model and the next render's load() would hit a freed pointer — the original crash). This
// guards the regression the adversarial review caught: a bare render() never exercises it.
test("DataGrid under StrictMode (simulated unmount→remount) mounts without throwing", () => {
  const { rerender, unmount, container } = render(
    <StrictMode><DataGrid data={SAMPLE} /></StrictMode>,
  );
  expect(container.querySelector("perspective-viewer")).toBeInTheDocument();
  // a churn after the StrictMode double-invoke must still be safe
  rerender(<StrictMode><DataGrid data={{ columns: ["a"], rows: [{ a: 1 }] }} /></StrictMode>);
  expect(container.querySelector("perspective-viewer")).toBeInTheDocument();
  expect(() => unmount()).not.toThrow();
});
