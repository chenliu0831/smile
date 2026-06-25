import { parseNumber, tableToChartable } from "./reportCharts";

// ── parseNumber: tolerant of the noise real report cells carry ──────────────
test("parseNumber strips markdown bold, percent, commas, arrows, and tildes", () => {
  expect(parseNumber("0.8848")).toBeCloseTo(0.8848);
  expect(parseNumber("**0.8876**")).toBeCloseTo(0.8876); // bolded winner
  expect(parseNumber("+0.32 %")).toBeCloseTo(0.32); // signed percent
  expect(parseNumber("-4.9 %")).toBeCloseTo(-4.9);
  expect(parseNumber("0.00 %")).toBe(0);
  expect(parseNumber("1,234")).toBe(1234); // thousands sep
  expect(parseNumber("25.6")).toBeCloseTo(25.6);
  expect(parseNumber("~0.766")).toBeCloseTo(0.766); // approx prefix
  expect(parseNumber("0.8848  ")).toBeCloseTo(0.8848); // whitespace
  expect(parseNumber("`42`")).toBe(42); // inline code
});

test("parseNumber returns null for blanks, dashes, ticks, and pure text", () => {
  for (const blank of ["", "—", "–", "-", "n/a", "N/A", "none", "✓", "✗", "TBD"]) {
    expect(parseNumber(blank)).toBeNull();
  }
  expect(parseNumber("RandomForest")).toBeNull();
  expect(parseNumber("gradient boosting")).toBeNull();
});

// ── tableToChartable: the real Candidate Comparison table ───────────────────
const CANDIDATE_HEADER = ["Model", "AUC ↑", "Std", "Acc", "F1", "Runtime (s)"];
const CANDIDATE_ROWS = [
  ["RandomForest", "0.8848", "0.0196", "0.8384", "0.7812", "2.2"],
  ["XGBoost", "0.8833", "0.0241", "0.8272", "0.7695", "1.2"],
  ["GBDT", "0.8786", "0.0265", "0.8294", "0.7683", "2.3"],
  ["KNN(15)", "0.8556", "0.0230", "0.8148", "0.7496", "1.3"], // label has digits — must NOT make Model numeric
  ["MLP (64-32)", "0.8549", "0.0210", "0.8159", "0.7523", "1.3"],
];

test("a candidate-comparison table charts AUC by model, label column detected despite digits in labels", () => {
  const c = tableToChartable(CANDIDATE_HEADER, CANDIDATE_ROWS);
  expect(c).not.toBeNull();
  expect(c!.labelName).toBe("Model");
  expect(c!.labels).toEqual(["RandomForest", "XGBoost", "GBDT", "KNN(15)", "MLP (64-32)"]);
  // All five numeric columns surface, with the arrow stripped from the AUC header.
  expect(c!.columns.map((col) => col.name)).toEqual(["AUC", "Std", "Acc", "F1", "Runtime (s)"]);
  // Default plotted column is the first numeric column after the label → AUC.
  expect(c!.columns[c!.defaultIndex].name).toBe("AUC");
  expect(c!.columns[c!.defaultIndex].values).toEqual([0.8848, 0.8833, 0.8786, 0.8556, 0.8549]);
});

// ── mixed-scale Final Performance table (bold + percent across columns) ─────
const PERF_HEADER = ["Metric", "Best single (RF)", "Final ensemble", "Improvement"];
const PERF_ROWS = [
  ["AUC-ROC", "0.8848", "**0.8876**", "+0.32 %"],
  ["Accuracy", "0.8384", "0.8384", "0.00 %"],
  ["Log-loss", "0.408", "0.388", "-4.9 %"],
];

test("a mixed-scale metrics table parses bold winners and percent deltas, label is Metric", () => {
  const c = tableToChartable(PERF_HEADER, PERF_ROWS);
  expect(c).not.toBeNull();
  expect(c!.labelName).toBe("Metric");
  expect(c!.columns.map((col) => col.name)).toEqual(["Best single (RF)", "Final ensemble", "Improvement"]);
  const ensemble = c!.columns.find((col) => col.name === "Final ensemble")!;
  expect(ensemble.values).toEqual([0.8876, 0.8384, 0.388]); // bold stripped
  const improvement = c!.columns.find((col) => col.name === "Improvement")!;
  expect(improvement.values).toEqual([0.32, 0, -4.9]); // percent stripped, signs kept
});

// ── Refinement History: a numeric column (Cycle) sits BEFORE the label ──────
const REFINE_HEADER = ["Cycle", "Version", "Strategy", "OOF AUC", "Δ vs prev"];
const REFINE_ROWS = [
  ["0", "best single (RF)", "baseline single model", "0.8848", "—"],
  ["1", "ensemble_stack_lr", "LR meta-learner", "0.8852", "+0.0004"],
  ["1", "ensemble_weighted", "AUC-weighted average", "**0.8876**", "+0.0028"],
];

test("label is the first NON-numeric column even when a numeric column precedes it; default skips pre-label numerics", () => {
  const c = tableToChartable(REFINE_HEADER, REFINE_ROWS);
  expect(c).not.toBeNull();
  expect(c!.labelName).toBe("Version"); // not "Cycle" (numeric) nor "Strategy"
  expect(c!.labels).toEqual(["best single (RF)", "ensemble_stack_lr", "ensemble_weighted"]);
  // Cycle is numeric and surfaces as a switchable column, but the DEFAULT is the first
  // numeric column appearing AFTER the label → OOF AUC, not Cycle.
  expect(c!.columns.map((col) => col.name)).toEqual(["Cycle", "OOF AUC", "Δ vs prev"]);
  expect(c!.columns[c!.defaultIndex].name).toBe("OOF AUC");
  // "—" blank parses to null (a gap), not a crash.
  const delta = c!.columns.find((col) => col.name === "Δ vs prev")!;
  expect(delta.values).toEqual([null, 0.0004, 0.0028]);
});

// ── the null cases: nothing to chart ────────────────────────────────────────
test("an all-text table (no numeric column) yields null", () => {
  const c = tableToChartable(
    ["Step", "Description"],
    [["EDA", "explored the data"], ["Model", "trained candidates"]],
  );
  expect(c).toBeNull();
});

test("an all-numeric table (no label column, e.g. a correlation matrix) yields null", () => {
  const c = tableToChartable(
    ["1.0", "0.3", "0.1"],
    [["0.3", "1.0", "0.2"], ["0.1", "0.2", "1.0"]],
  );
  expect(c).toBeNull();
});

test("a header-only table (no data rows) yields null", () => {
  expect(tableToChartable(["Model", "AUC"], [])).toBeNull();
});

// ── crash-safety: malformed agent output must never throw ───────────────────
test("ragged rows, empty cells, and a bare pipe do not throw and still chart the good data", () => {
  const header = ["Model", "AUC", "Notes"];
  const rows = [
    ["RandomForest", "0.88", "ok"],
    ["XGBoost"], // ragged: missing cells
    ["", "", ""], // all-empty row
    ["GBDT", "not-a-number", "weird"], // non-numeric in the numeric column
    ["LightGBM", "0.87", "fine"],
  ];
  expect(() => tableToChartable(header, rows)).not.toThrow();
  const c = tableToChartable(header, rows);
  expect(c).not.toBeNull();
  expect(c!.labelName).toBe("Model");
  // AUC column is numeric: of its 3 non-empty cells (0.88, "not-a-number", 0.87), 2 parse —
  // a strict majority. Junk/blank cells become null gaps, never a crash.
  const auc = c!.columns.find((col) => col.name === "AUC")!;
  expect(auc.values).toEqual([0.88, null, null, null, 0.87]);
});

// ── majority rule: a stray numeric in a text column must NOT make it numeric (#3) ──
test("a text label column with one numeric-looking cell stays the label, chart still renders", () => {
  // "Phase" is mostly text (EDA/Model/Final) with one stray "2020" — must remain the label,
  // not be misclassified numeric (which would leave no label column and suppress the chart).
  const c = tableToChartable(
    ["Phase", "Score"],
    [["EDA", "0.1"], ["Model", "0.8"], ["2020", "0.9"], ["Final", "0.95"]],
  );
  expect(c).not.toBeNull();
  expect(c!.labelName).toBe("Phase");
  expect(c!.labels).toEqual(["EDA", "Model", "2020", "Final"]);
  expect(c!.columns.map((col) => col.name)).toEqual(["Score"]);
});

test("a column that is half-numeric (tie) is treated as text, not numeric", () => {
  // 2 of 4 parse — not a strict majority, so "Mixed" is text (becomes the label here).
  const c = tableToChartable(
    ["Mixed", "Value"],
    [["1", "0.1"], ["two", "0.2"], ["3", "0.3"], ["four", "0.4"]],
  );
  expect(c).not.toBeNull();
  expect(c!.labelName).toBe("Mixed");
  expect(c!.columns.map((col) => col.name)).toEqual(["Value"]);
});

// ── lock the lenient parseNumber behavior the reviewer flagged as untested (#12) ──
test("parseNumber's documented lenient acceptances are pinned", () => {
  expect(parseNumber("1e3")).toBe(1000); // scientific notation (Number accepts it)
  expect(parseNumber(".5")).toBe(0.5);
});
