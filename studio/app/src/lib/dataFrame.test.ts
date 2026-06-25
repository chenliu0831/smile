import { columnTableToGrid } from "./dataFrame";

test("columnTableToGrid converts column-JSON into ordered columns + row objects", () => {
  const grid = columnTableToGrid({
    model: ["rf", "xgb"],
    auc: [0.8848, 0.8833],
  });
  expect(grid.columns).toEqual(["model", "auc"]);
  expect(grid.rows).toEqual([
    { model: "rf", auc: 0.8848 },
    { model: "xgb", auc: 0.8833 },
  ]);
});

test("pads ragged columns with null (never throws on uneven lengths)", () => {
  const grid = columnTableToGrid({ a: [1, 2, 3], b: ["x"] });
  expect(grid.rows).toEqual([
    { a: 1, b: "x" },
    { a: 2, b: null },
    { a: 3, b: null },
  ]);
});

test("empty table → no columns, no rows", () => {
  expect(columnTableToGrid({})).toEqual({ columns: [], rows: [] });
});
