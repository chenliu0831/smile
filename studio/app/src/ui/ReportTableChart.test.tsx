/**
 * ReportTableChart (ADR-0016): a numeric report table renders an inline bar of its first
 * numeric column, with a picker to switch column. ECharts draws to a <canvas> jsdom lacks, so
 * it's stubbed to a marker that exposes the option it was handed — we assert the data wiring,
 * not the pixels.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { vi, test, expect } from "vitest";

let lastOption: Record<string, unknown> | null = null;
vi.mock("echarts-for-react", () => ({
  default: ({ option }: { option: Record<string, unknown> }) => {
    lastOption = option;
    return <div data-testid="echarts" />;
  },
}));

import { ReportTableChart } from "./ReportTableChart";
import { Markdown } from "./Markdown";
import { tableToChartable } from "../lib/reportCharts";

const HEADER = ["Model", "AUC", "Std", "Runtime (s)"];
const ROWS = [
  ["RandomForest", "0.8848", "0.0196", "2.2"],
  ["XGBoost", "0.8833", "0.0241", "1.2"],
  ["GBDT", "0.8786", "0.0265", "25.6"],
];

/** The chart pairs the category axis (yAxis) with the bar data positionally. Zip them back
 *  into a label→value map so assertions are agnostic to ECharts' bottom-up axis ordering. */
function pairs(opt: Record<string, unknown> | null): Record<string, unknown> {
  const cats = ((opt?.yAxis as { data?: unknown[] })?.data) ?? [];
  const data = ((opt?.series as { data: unknown[] }[]) ?? [])[0]?.data ?? [];
  const out: Record<string, unknown> = {};
  cats.forEach((c, i) => { out[String(c)] = data[i]; });
  return out;
}

test("renders a bar of the default (first) numeric column against the labels", () => {
  lastOption = null;
  const chartable = tableToChartable(HEADER, ROWS)!;
  render(<ReportTableChart chartable={chartable} />);
  expect(screen.getByTestId("echarts")).toBeInTheDocument();
  // Default column is AUC; each model pairs with its AUC.
  expect(pairs(lastOption)).toEqual({ RandomForest: 0.8848, XGBoost: 0.8833, GBDT: 0.8786 });
});

test("the picker switches which numeric column is plotted, recomputing the bar", () => {
  lastOption = null;
  const chartable = tableToChartable(HEADER, ROWS)!;
  render(<ReportTableChart chartable={chartable} />);

  const picker = screen.getByTestId("report-chart-picker") as HTMLSelectElement;
  // All numeric columns are options (option text = column name; option value = index).
  expect([...picker.options].map((o) => o.text)).toEqual(["AUC", "Std", "Runtime (s)"]);

  // Select "Runtime (s)" — index 2 in the numeric columns.
  fireEvent.change(picker, { target: { value: "2" } });
  expect(pairs(lastOption)).toEqual({ RandomForest: 2.2, XGBoost: 1.2, GBDT: 25.6 });
});

test("two columns that clean to the same header are independently selectable (index-keyed)", () => {
  lastOption = null;
  // Two distinct numeric columns both named "Score" — a name-keyed picker would make the
  // second unaddressable. Build the chartable directly (the parser doesn't de-dup names).
  const chartable = {
    labelName: "Model",
    labels: ["A", "B"],
    columns: [
      { name: "Score", values: [0.1, 0.2] }, // train score
      { name: "Score", values: [0.9, 0.8] }, // test score, same header
    ],
    defaultIndex: 0,
  };
  render(<ReportTableChart chartable={chartable} />);
  const picker = screen.getByTestId("report-chart-picker") as HTMLSelectElement;
  // Default is the first "Score".
  expect(pairs(lastOption)).toEqual({ A: 0.1, B: 0.2 });
  // Selecting index 1 reaches the SECOND "Score" — impossible with a name-keyed picker.
  fireEvent.change(picker, { target: { value: "1" } });
  expect(pairs(lastOption)).toEqual({ A: 0.9, B: 0.8 });
});

test("does not render a picker when there is only one numeric column", () => {
  const chartable = tableToChartable(
    ["Metric", "Value"],
    [["AUC", "0.88"], ["F1", "0.78"]],
  )!;
  render(<ReportTableChart chartable={chartable} />);
  expect(screen.getByTestId("echarts")).toBeInTheDocument();
  expect(screen.queryByTestId("report-chart-picker")).toBeNull();
});

// ── integration: Markdown renders a chart in-place below a numeric table ─────
const REPORT = `# AutoML Report

## Candidate Comparison

| Model | AUC | Runtime (s) |
|-------|-----|-------------|
| RandomForest | 0.8848 | 2.2 |
| XGBoost | 0.8833 | 1.2 |

Some prose after the table.

## Pipeline Steps

| Step | Description |
|------|-------------|
| EDA | explored the data |
| Model | trained candidates |
`;

test("Markdown renders the table AND an inline chart for a numeric table, in place", () => {
  lastOption = null;
  render(<Markdown source={REPORT} />);
  // The original table is still rendered (chart is additive, not a replacement).
  expect(screen.getAllByRole("table").length).toBeGreaterThanOrEqual(1);
  // A Report Chart surfaces for the numeric Candidate Comparison table.
  const charts = screen.getAllByTestId("report-chart");
  expect(charts).toHaveLength(1); // the all-text "Pipeline Steps" table gets NO chart
  expect(pairs(lastOption)).toEqual({ RandomForest: 0.8848, XGBoost: 0.8833 });
});
