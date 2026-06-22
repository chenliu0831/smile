/**
 * Renders a DataViz call (a chart spec, ADR-0007) natively with ECharts. Fetches the
 * backing table from the daemon's /data/{ref} endpoint (which resolves a shared-session
 * DuckDB table). With no daemon, or if the fetch fails, the chart renders empty (just its
 * title) — never fabricated data.
 */
import { useEffect, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { DataVizSpec } from "../daemon/protocol";
import { useRunContext } from "../store/RunContext";

/** Column-oriented table the /data/{ref} endpoint returns: column name -> values. */
type ColumnTable = Record<string, (number | string)[]>;

const AXIS = { axisLine: { lineStyle: { color: "#2a3340" } }, axisLabel: { color: "#8b98a8" } };
const BASE = {
  backgroundColor: "transparent",
  textStyle: { color: "#e6edf3", fontFamily: "inherit" },
  grid: { left: 60, right: 20, top: 40, bottom: 40 },
  title: { left: "center", textStyle: { color: "#e6edf3", fontSize: 13 } },
};

function buildOption(spec: DataVizSpec, t: ColumnTable | undefined): Record<string, unknown> {
  const e = spec.encodings;
  if (!t) return { ...BASE, title: { ...BASE.title, text: spec.title ?? "" } };

  const title = { ...BASE.title, text: spec.title ?? "" };

  switch (spec.type) {
    case "line": {
      return {
        ...BASE, title,
        xAxis: { type: "value", name: e.x, ...AXIS },
        yAxis: { type: "value", name: e.y, ...AXIS },
        series: [{
          type: "line", smooth: true, showSymbol: false,
          lineStyle: { color: "#4ea8de", width: 2 },
          areaStyle: { color: "rgba(78,168,222,0.12)" },
          data: (t[e.x] as number[]).map((x, i) => [x, (t[e.y] as number[])[i]]),
        }],
      };
    }
    case "bar": {
      // Horizontal bar (feature importance): categories on Y.
      return {
        ...BASE, title,
        xAxis: { type: "value", name: e.x, ...AXIS },
        yAxis: { type: "category", data: t[e.y] as string[], ...AXIS, inverse: true },
        series: [{ type: "bar", itemStyle: { color: "#4ea8de" }, data: t[e.x] as number[] }],
      };
    }
    case "scatter": {
      return {
        ...BASE, title,
        xAxis: { type: "value", name: e.x, ...AXIS },
        yAxis: { type: "value", name: e.y, ...AXIS },
        series: [{ type: "scatter", itemStyle: { color: "#4ea8de" },
          data: (t[e.x] as number[]).map((x, i) => [x, (t[e.y] as number[])[i]]) }],
      };
    }
    case "heatmap": {
      const xs = [...new Set(t[e.x] as string[])];
      const ys = [...new Set(t[e.y] as string[])];
      const data = (t[e.value!] as number[]).map((v, i) => [
        xs.indexOf((t[e.x] as string[])[i]),
        ys.indexOf((t[e.y] as string[])[i]),
        v,
      ]);
      const vals = t[e.value!] as number[];
      return {
        ...BASE, title,
        xAxis: { type: "category", data: xs, ...AXIS },
        yAxis: { type: "category", data: ys, ...AXIS },
        visualMap: { min: Math.min(...vals), max: Math.max(...vals), show: false,
          inRange: { color: ["#16314a", "#4ea8de", "#9ad8ff"] } },
        series: [{ type: "heatmap", data, label: { show: true, color: "#e6edf3" } }],
      };
    }
    case "boxplot":
    default:
      return { ...BASE, title };
  }
}

export function Chart({ spec }: { spec: DataVizSpec }) {
  const { httpBase } = useRunContext();
  const [table, setTable] = useState<ColumnTable | undefined>(undefined);

  // Fetch the backing table from the daemon. No daemon or a failed fetch → undefined, which
  // buildOption renders as an empty (titled) chart — never fabricated data.
  useEffect(() => {
    let cancelled = false;
    if (!httpBase) {
      setTable(undefined);
      return;
    }
    fetch(`${httpBase}/data/${encodeURIComponent(spec.dataRef.ref)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled) setTable(json ?? undefined);
      })
      .catch(() => {
        if (!cancelled) setTable(undefined);
      });
    return () => { cancelled = true; };
  }, [httpBase, spec.dataRef.ref]);

  return (
    <ReactECharts
      option={buildOption(spec, table)}
      style={{ height: 320, width: "100%" }}
      notMerge
      theme="dark"
    />
  );
}
