import {
  detectPredictionSchema,
  toPredictionRows,
  confusionAt,
  metricsFrom,
  rocCurve,
  aucFrom,
  thresholdMaximisingF1,
  type ColumnTable,
} from "./predictions";

// A tiny, hand-checkable prediction set: 3 positives, 3 negatives, cleanly separable at 0.5.
const table: ColumnTable = {
  PassengerId: [1, 2, 3, 4, 5, 6],
  Survived_proba: [0.9, 0.8, 0.6, 0.4, 0.2, 0.1],
  Survived_actual: [1, 1, 0, 1, 0, 0],
};

test("detects the <target>_proba / <target>_actual schema", () => {
  const schema = detectPredictionSchema(table);
  expect(schema).toEqual({ probaCol: "Survived_proba", actualCol: "Survived_actual", target: "Survived" });
});

test("returns null when no proba/actual pair exists (regression / unlabeled)", () => {
  expect(detectPredictionSchema({ x: [1, 2], y: [3, 4] })).toBeNull();
  expect(detectPredictionSchema({ Survived_proba: [0.5] })).toBeNull(); // no _actual
  expect(detectPredictionSchema(undefined)).toBeNull();
});

test("builds prediction rows and tolerates malformed values (crash-safety)", () => {
  const messy: ColumnTable = {
    Churn_proba: [0.7, "N/A" as unknown as number, 0.3, 0.9],
    Churn_actual: [1, 0, 2 as unknown as number, 0], // 2 is not a valid label
  };
  const schema = detectPredictionSchema(messy)!;
  const rows = toPredictionRows(messy, schema);
  // Row 1 (NaN proba) and row 2 (label 2) are skipped; rows 0 and 3 survive.
  expect(rows).toEqual([
    { proba: 0.7, actual: 1 },
    { proba: 0.9, actual: 0 },
  ]);
  expect(rows.every((r) => Number.isFinite(r.proba))).toBe(true);
});

test("confusion counts at a threshold (predicted positive iff proba >= threshold)", () => {
  const rows = toPredictionRows(table, detectPredictionSchema(table)!);
  // At 0.5: predicted positive = {0.9,0.8,0.6}=ids1-3, predicted negative = {0.4,0.2,0.1}=ids4-6.
  // actuals: id1=1,id2=1,id3=0 | id4=1,id5=0,id6=0
  // tp = id1,id2 = 2; fp = id3 = 1; fn = id4 = 1; tn = id5,id6 = 2
  expect(confusionAt(rows, 0.5)).toEqual({ tp: 2, fp: 1, tn: 2, fn: 1 });
});

test("derives accuracy/precision/recall/F1 from a confusion matrix", () => {
  const m = metricsFrom({ tp: 2, fp: 1, tn: 2, fn: 1 });
  expect(m.accuracy).toBeCloseTo(4 / 6);
  expect(m.precision).toBeCloseTo(2 / 3);
  expect(m.recall).toBeCloseTo(2 / 3);
  expect(m.f1).toBeCloseTo(2 / 3);
});

test("metrics never divide by zero (empty / degenerate inputs)", () => {
  expect(metricsFrom({ tp: 0, fp: 0, tn: 0, fn: 0 })).toEqual({
    accuracy: 0, precision: 0, recall: 0, f1: 0,
  });
});

test("ROC curve spans the unit square and AUC is 1.0 for a perfectly separable set", () => {
  // Make it perfectly separable: positives strictly above negatives.
  const sep: ColumnTable = {
    t_proba: [0.95, 0.9, 0.85, 0.2, 0.1, 0.05],
    t_actual: [1, 1, 1, 0, 0, 0],
  };
  const rows = toPredictionRows(sep, detectPredictionSchema(sep)!);
  const roc = rocCurve(rows);
  expect(roc[0]).toEqual({ fpr: 0, tpr: 0, threshold: Infinity });
  expect(roc[roc.length - 1]).toEqual({ fpr: 1, tpr: 1, threshold: -Infinity });
  expect(aucFrom(roc)).toBeCloseTo(1.0);
});

test("ROC curve is empty when one class is absent (undefined AUC)", () => {
  const oneClass: ColumnTable = { t_proba: [0.4, 0.6], t_actual: [1, 1] };
  const rows = toPredictionRows(oneClass, detectPredictionSchema(oneClass)!);
  expect(rocCurve(rows)).toEqual([]);
});

test("thresholdMaximisingF1 picks the F1-optimal sweep point", () => {
  const rows = toPredictionRows(table, detectPredictionSchema(table)!);
  const t = thresholdMaximisingF1(rows);
  // The chosen threshold's F1 is at least as good as F1 at the 0.5 operating point.
  const f1At = (thr: number) => metricsFrom(confusionAt(rows, thr)).f1;
  expect(f1At(t)).toBeGreaterThanOrEqual(f1At(0.5));
});
