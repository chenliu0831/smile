import {
  defaultMetric,
  parseLeaderboard,
  classifyModel,
  sortCandidates,
  ensembleVerdict,
} from "./leaderboard";

const candidateScoresMd = `
# Candidate Scores

| Candidate | Val Score | Std (CV) | Params | Runtime (s) | Notes |
|---|---|---|---|---|---|
| candidate_lgbm | 0.913 | 0.008 | n_estimators=500 | 42 | gradient boosting |
| candidate_rf | 0.881 | 0.011 | trees=500 | 31 | random forest |
| candidate_mlp | 0.902 | 0.014 | ReLU(128) | 88 | neural net |
`;

test("parses each table row into a candidate with name and validation score", () => {
  const board = parseLeaderboard(candidateScoresMd, { metric: "AUC", higherIsBetter: true });
  expect(board.rows).toHaveLength(3);
  const lgbm = board.rows.find((r) => r.name === "candidate_lgbm");
  expect(lgbm?.score).toBeCloseTo(0.913);
  expect(lgbm?.std).toBeCloseTo(0.008);
  expect(lgbm?.notes).toBe("gradient boosting");
});

test("tolerates malformed agent output without throwing (crash-safety)", () => {
  // Empty cells, non-numeric scores, ragged rows, a bare pipe — must not throw and must
  // skip the junk rows (this class of input previously crashed the app via .toFixed).
  const messy = `
| Candidate | Val Score | Std |
|---|---|---|
|
| good_model | 0.91 | 0.01 |
| bad_score | N/A | — |
| missing_cols |
| ragged | 0.77 |
`;
  const board = parseLeaderboard(messy, { metric: "AUC", higherIsBetter: true });
  expect(board.rows.map((r) => r.name)).toEqual(["good_model", "ragged"]);
  expect(board.rows.every((r) => Number.isFinite(r.score))).toBe(true);
  // ragged row had no std cell → undefined (renders as "—", never .toFixed on NaN)
  expect(board.rows.find((r) => r.name === "ragged")?.std).toBeUndefined();
});

test("maps problem type to its default ranking metric (ADR-0004)", () => {
  expect(defaultMetric("binary")).toEqual({ metric: "AUC", higherIsBetter: true });
  expect(defaultMetric("multiclass")).toEqual({
    metric: "mean-per-class-error",
    higherIsBetter: false,
  });
  expect(defaultMetric("regression")).toEqual({ metric: "RMSE", higherIsBetter: false });
});

test("ranks best-first for a higher-is-better metric (AUC)", () => {
  const board = parseLeaderboard(candidateScoresMd, { metric: "AUC", higherIsBetter: true });
  expect(board.rows.map((r) => r.name)).toEqual([
    "candidate_lgbm",
    "candidate_mlp",
    "candidate_rf",
  ]);
});

test("ranks best-first for a lower-is-better metric (RMSE)", () => {
  const rmseMd = `
| Candidate | Val Score | Std (CV) | Params | Runtime (s) | Notes |
|---|---|---|---|---|---|
| candidate_a | 4.2 | 0.1 | x | 10 | a |
| candidate_b | 3.1 | 0.1 | y | 12 | b |
| candidate_c | 5.0 | 0.1 | z | 9 | c |
`;
  const board = parseLeaderboard(rmseMd, { metric: "RMSE", higherIsBetter: false });
  expect(board.rows.map((r) => r.name)).toEqual([
    "candidate_b",
    "candidate_a",
    "candidate_c",
  ]);
});

test("classifies model type from name + notes (ensemble > tuned > default)", () => {
  expect(classifyModel("Ensemble (weighted avg)", "")).toBe("ensemble");
  expect(classifyModel("hill_climb_blend", "")).toBe("ensemble");
  expect(classifyModel("candidate_xgb", "tuned via Optuna")).toBe("tuned");
  expect(classifyModel("candidate_lgbm", "gradient boosting")).toBe("default");
  // ensemble wins when both signals are present
  expect(classifyModel("tuned ensemble", "tuned")).toBe("ensemble");
});

test("parseLeaderboard populates modelType on each row", () => {
  const md = `
| Candidate | Val Score | Std | Params | Runtime | Notes |
|---|---|---|---|---|---|
| Ensemble (avg) | 0.92 | — | — | 5 | weighted average |
| candidate_xgb | 0.91 | 0.01 | d=6 | 51 | tuned |
| candidate_rf | 0.88 | 0.01 | t=500 | 31 | random forest |
`;
  const board = parseLeaderboard(md, { metric: "AUC", higherIsBetter: true });
  const byName = Object.fromEntries(board.rows.map((r) => [r.name, r.modelType]));
  expect(byName["Ensemble (avg)"]).toBe("ensemble");
  expect(byName["candidate_xgb"]).toBe("tuned");
  expect(byName["candidate_rf"]).toBe("default");
  // The "—" std cell parses to undefined (whisker suppressed), not NaN.
  expect(board.rows.find((r) => r.name === "Ensemble (avg)")?.std).toBeUndefined();
});

test("sortCandidates sorts by name, runtime, and metric-aware score", () => {
  const board = parseLeaderboard(candidateScoresMd, { metric: "AUC", higherIsBetter: true });
  expect(sortCandidates(board.rows, "name", true).map((r) => r.name)).toEqual([
    "candidate_lgbm", "candidate_mlp", "candidate_rf",
  ]);
  // runtime ascending: rf(31) < lgbm(42) < mlp(88)
  expect(sortCandidates(board.rows, "runtimeSec", true).map((r) => r.name)).toEqual([
    "candidate_rf", "candidate_lgbm", "candidate_mlp",
  ]);
});

test("ensembleVerdict computes lift over the best base learner, pinned to one board", () => {
  const md = `
| Candidate | Val Score | Std | Params | Runtime | Notes |
|---|---|---|---|---|---|
| Ensemble (avg) | 0.924 | — | — | 5 | weighted average |
| candidate_lgbm | 0.913 | 0.008 | lr=0.05 | 42 | gbm |
`;
  const board = parseLeaderboard(md, { metric: "AUC", higherIsBetter: true });
  const v = ensembleVerdict(board)!;
  expect(v.ensemble.name).toBe("Ensemble (avg)");
  expect(v.bestBase.name).toBe("candidate_lgbm");
  expect(v.beatsBest).toBe(true);
  expect(v.lift).toBeCloseTo(0.011);
});

test("ensembleVerdict returns null when there is no ensemble row", () => {
  const board = parseLeaderboard(candidateScoresMd, { metric: "AUC", higherIsBetter: true });
  expect(ensembleVerdict(board)).toBeNull();
});
