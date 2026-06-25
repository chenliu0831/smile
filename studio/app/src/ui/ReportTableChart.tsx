/**
 * Report Chart (ADR-0016): the inline native bar shown directly below a numeric markdown
 * table inside a report. Plots one numeric column (default: the first) against the table's
 * label column, with a picker to switch column when there is more than one. The data is
 * INLINE (already parsed from the markdown by lib/reportCharts) — unlike a DataViz call, it
 * does not fetch /data/{ref}.
 *
 * One numeric column is charted at a time, never multi-series: report tables mix scales in
 * adjacent columns (AUC ~0.88 next to Log-loss ~0.39 next to a percent delta), so a grouped
 * bar would be misleading.
 */
import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { ChartableTable } from "../lib/reportCharts";

const AXIS = { axisLine: { lineStyle: { color: "#2a3340" } }, axisLabel: { color: "#8b98a8" } };

export function ReportTableChart({ chartable }: { chartable: ChartableTable }) {
  const [index, setIndex] = useState(chartable.defaultIndex);
  // Guard against an out-of-range index if the same component is reused for a smaller table.
  const col = chartable.columns[index] ?? chartable.columns[chartable.defaultIndex] ?? chartable.columns[0];

  const option = useMemo(() => {
    // ECharts category axis renders bottom-up; reverse rows so the first table row sits on top.
    const order = chartable.labels.map((_, i) => i).reverse();
    return {
      backgroundColor: "transparent",
      textStyle: { color: "#e6edf3", fontFamily: "inherit" },
      grid: { left: 8, right: 24, top: 12, bottom: 28, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value", name: col.name, nameLocation: "end", nameTextStyle: { color: "#8b98a8" }, ...AXIS },
      yAxis: { type: "category", data: order.map((i) => chartable.labels[i]), ...AXIS },
      series: [
        {
          type: "bar",
          // null gaps render as no bar (ECharts skips null), never as 0 — honest about missing cells.
          data: order.map((i) => col.values[i]),
          itemStyle: { color: "#4ea8de", borderRadius: [0, 3, 3, 0] },
          barWidth: "55%",
        },
      ],
    };
  }, [chartable, col]);

  return (
    <div className="report-chart" data-testid="report-chart">
      {chartable.columns.length > 1 && (
        <label className="report-chart-picker-wrap">
          <span>Plot</span>
          <select
            data-testid="report-chart-picker"
            className="report-chart-picker"
            // Key/select by INDEX, not name: two report columns can clean to the same header
            // (e.g. two blank headers, or two "Score" columns), and a name-keyed picker would
            // make the duplicate unselectable (findIndex returns the first) + warn on dup keys.
            value={String(index)}
            onChange={(e) => setIndex(Number(e.target.value))}
          >
            {chartable.columns.map((c, i) => (
              <option key={i} value={i}>{c.name}</option>
            ))}
          </select>
        </label>
      )}
      <ReactECharts
        option={option}
        style={{ height: Math.max(140, chartable.labels.length * 34 + 56), width: "100%" }}
        notMerge
        theme="dark"
      />
    </div>
  );
}
