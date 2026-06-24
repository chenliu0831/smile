import { parseMetrics, normalizeTaskType } from "./metrics";

test("parses framing fields and headline scores in display order", () => {
  const meta = {
    task_type: "binary_classification",
    primary_metric: "AUC",
    cv: "5-fold",
    rows: 891,
    ensemble_method: "weighted_average",
    oof_auc: 0.895,
    test_auc: 0.860,
    test_acc: 0.827,
    test_f1: 0.763,
  };
  const m = parseMetrics(meta)!;
  expect(m.taskType).toBe("binary");
  expect(m.primaryMetric).toBe("AUC");
  expect(m.cv).toBe("5-fold");
  expect(m.rows).toBe(891);
  expect(m.ensembleMethod).toBe("weighted_average");
  expect(m.scores).toEqual([
    { label: "OOF", value: 0.895, source: "oof_auc" },
    { label: "TEST", value: 0.860, source: "test_auc" },
    { label: "ACC", value: 0.827, source: "test_acc" },
    { label: "F1", value: 0.763, source: "test_f1" },
  ]);
});

test("normalizeTaskType maps free-form strings to ProblemType", () => {
  expect(normalizeTaskType("binary_classification")).toBe("binary");
  expect(normalizeTaskType("multiclass")).toBe("multiclass");
  expect(normalizeTaskType("regression")).toBe("regression");
  expect(normalizeTaskType("clustering")).toBeUndefined();
  expect(normalizeTaskType(undefined)).toBeUndefined();
});

test("tolerates alternate key spellings and string numbers", () => {
  const m = parseMetrics({ problem_type: "regression", metric: "RMSE", test_score: "3.14", n_train: "1000" })!;
  expect(m.taskType).toBe("regression");
  expect(m.primaryMetric).toBe("RMSE");
  expect(m.rows).toBe(1000);
  expect(m.scores).toEqual([{ label: "TEST", value: 3.14, source: "test_score" }]);
});

test("returns null when there is nothing usable (graceful absence)", () => {
  expect(parseMetrics(null)).toBeNull();
  expect(parseMetrics({})).toBeNull();
  expect(parseMetrics({ unrelated: "x" })).toBeNull();
  expect(parseMetrics([1, 2, 3])).toBeNull();
});
