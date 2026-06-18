import { render } from "@testing-library/react";
import { tableFromIPC } from "apache-arrow";
import { DataGrid, columnsToArrow, toArrowIPC } from "./DataGrid";

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

test("DataGrid mounts without throwing given a small dataset", () => {
  const { container } = render(<DataGrid data={SAMPLE} />);
  expect(container.querySelector("perspective-viewer")).toBeInTheDocument();
});
