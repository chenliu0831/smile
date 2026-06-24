import { parseDiagnostics, stabilityLabel } from "./diagnostics";

test("parses the documented top5_features shape (mean ± std), sorted descending", () => {
  const meta = {
    top5_features: [
      { feature: "Age", mean: 0.038, std: 0.014 },
      { feature: "Title_Mr", mean: 0.066, std: 0.018 },
      { feature: "Title_Mrs", mean: 0.025, std: 0.005 },
    ],
  };
  const rows = parseDiagnostics(meta);
  expect(rows.map((r) => r.name)).toEqual(["Title_Mr", "Age", "Title_Mrs"]);
  expect(rows[0]).toEqual({ name: "Title_Mr", mean: 0.066, std: 0.018 });
});

test("tolerates alternate field names and a bare array (defensive)", () => {
  const meta = [
    { name: "f1", importance: "0.5", stddev: "0.1" }, // string numbers, alt keys
    { column: "f2", value: 0.3 }, // no std
  ];
  const rows = parseDiagnostics(meta);
  expect(rows).toEqual([
    { name: "f1", mean: 0.5, std: 0.1 },
    { name: "f2", mean: 0.3 },
  ]);
});

test("skips rows without a usable name or finite mean; never throws", () => {
  const meta = {
    feature_importance: [
      { feature: "good", mean: 0.2 },
      { feature: "", mean: 0.9 }, // empty name
      { mean: 0.9 }, // no name
      { feature: "bad", mean: "N/A" }, // non-numeric mean
    ],
  };
  const rows = parseDiagnostics(meta);
  expect(rows.map((r) => r.name)).toEqual(["good"]);
});

test("returns [] for junk / empty meta (graceful absence)", () => {
  expect(parseDiagnostics(null)).toEqual([]);
  expect(parseDiagnostics({})).toEqual([]);
  expect(parseDiagnostics({ unrelated: 5 })).toEqual([]);
  expect(parseDiagnostics("nope")).toEqual([]);
});

test("stabilityLabel reads stable / noisy from the std-to-mean ratio", () => {
  expect(stabilityLabel({ name: "A", mean: 0.066, std: 0.005 })).toMatch(/stable/);
  expect(stabilityLabel({ name: "B", mean: 0.018, std: 0.012 })).toMatch(/noisy/);
  expect(stabilityLabel({ name: "C", mean: 0.04 })).toBe("C: importance 0.040");
});
