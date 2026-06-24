import { parseParams, paramsForModel, toPythonDict, paramDeltas } from "./params";

test("parses nested {params, default_params} and bare-params forms", () => {
  const meta = {
    xgb: { params: { n_estimators: 406, max_depth: 5, lr: 0.094 }, default_params: { n_estimators: 100, max_depth: 6, lr: 0.3 } },
    lgbm: { num_leaves: 31, learning_rate: 0.05 }, // bare form
  };
  const p = parseParams(meta);
  expect(p.xgb.params).toEqual({ n_estimators: 406, max_depth: 5, lr: 0.094 });
  expect(p.xgb.defaults).toEqual({ n_estimators: 100, max_depth: 6, lr: 0.3 });
  expect(p.lgbm.params).toEqual({ num_leaves: 31, learning_rate: 0.05 });
  expect(p.lgbm.defaults).toBeUndefined();
});

test("returns {} for junk meta (graceful)", () => {
  expect(parseParams(null)).toEqual({});
  expect(parseParams([1, 2])).toEqual({});
  expect(parseParams({ xgb: "nope" })).toEqual({});
});

test("paramsForModel tolerates candidate_ prefix and substring matches (xgb≠xgboost guard)", () => {
  const p = parseParams({ xgb: { params: { d: 5 } }, lgbm: { params: { n: 31 } } });
  expect(paramsForModel(p, "candidate_xgb")?.params).toEqual({ d: 5 });
  expect(paramsForModel(p, "Tuned XGB")?.params).toEqual({ d: 5 });
  expect(paramsForModel(p, "candidate_lgbm")?.params).toEqual({ n: 31 });
  expect(paramsForModel(p, "random_forest")).toBeUndefined();
});

test("toPythonDict renders a copy-pasteable literal with typed values", () => {
  const dict = toPythonDict({ n_estimators: 406, booster: "gbtree", use_gpu: true });
  expect(dict).toBe("{\n    'n_estimators': 406,\n    'booster': 'gbtree',\n    'use_gpu': True,\n}");
});

test("paramDeltas flags changed keys against defaults", () => {
  const deltas = paramDeltas({ params: { a: 5, b: 2 }, defaults: { a: 1, b: 2 } });
  expect(deltas).toEqual([
    { key: "a", tuned: 5, default: 1, changed: true },
    { key: "b", tuned: 2, default: 2, changed: false },
  ]);
});

test("paramDeltas marks nothing changed when no defaults are present", () => {
  const deltas = paramDeltas({ params: { a: 5 } });
  expect(deltas).toEqual([{ key: "a", tuned: 5, default: undefined, changed: false }]);
});
