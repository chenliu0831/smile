/**
 * Driver Diagnostics (S4, ADR-0011/0013): permutation importance as a horizontal bar chart
 * with ±1 std whiskers. The 5-row importance array rides INLINE in the diagnostics artifact's
 * `meta` (no DuckDB round-trip), parsed defensively by ../lib/diagnostics. Whiskers render via
 * an ECharts `custom` series (the error-bar build noted in ADR-0013 — not plain SVG), shown
 * only where std is finite. Each feature is an EDA entry point: "Ask Clair" / "Slice by it"
 * reuse the existing user-message steering seam.
 */
import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { Artifact } from "../daemon/protocol";
import { useRunContext } from "../store/RunContext";
import { parseDiagnostics, stabilityLabel, type FeatureImportance } from "../lib/diagnostics";

const AXIS = { axisLine: { lineStyle: { color: "#2a3340" } }, axisLabel: { color: "#8b98a8" } };

/** ECharts custom-series renderer: a horizontal ±std whisker centered on each bar's tip. */
function renderWhisker(params: unknown, api: { value: (i: number) => number; coord: (p: number[]) => number[]; size?: (v: number[]) => number[] }) {
  const idx = (params as { dataIndex: number }).dataIndex;
  const mean = api.value(1);
  const std = api.value(2);
  if (!Number.isFinite(std) || std <= 0) return { type: "group", children: [] };
  const left = api.coord([mean - std, idx]);
  const right = api.coord([mean + std, idx]);
  const cap = 4;
  const line = (x1: number, y1: number, x2: number, y2: number) => ({
    type: "line" as const,
    shape: { x1, y1, x2, y2 },
    style: { stroke: "rgba(230,237,243,0.65)", lineWidth: 1 },
  });
  return {
    type: "group",
    children: [
      line(left[0], left[1], right[0], right[1]),
      line(left[0], left[1] - cap, left[0], left[1] + cap),
      line(right[0], right[1] - cap, right[0], right[1] + cap),
    ],
  };
}

export function PermImportanceChart({ artifact }: { artifact: Artifact }) {
  const { sendMessage } = useRunContext();
  const features = useMemo(() => parseDiagnostics(artifact.meta), [artifact.meta]);
  const [selected, setSelected] = useState<FeatureImportance | null>(null);

  if (features.length === 0) {
    return <div className="canvas-empty">No feature importances to show for this run.</div>;
  }

  // ECharts category axis renders bottom-up; reverse so the strongest driver is on top.
  const ordered = [...features].reverse();
  const names = ordered.map((f) => f.name);
  // Each datum: [mean (bar), mean, std] so the custom whisker series can read mean/std.
  const data = ordered.map((f) => [f.mean, f.mean, f.std ?? NaN]);
  const maxX = Math.max(...features.map((f) => f.mean + (f.std ?? 0))) * 1.1;

  const option = {
    backgroundColor: "transparent",
    textStyle: { color: "#e6edf3", fontFamily: "inherit" },
    grid: { left: 110, right: 24, top: 16, bottom: 32 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: () => "", // tooltip content handled via the side panel; keep hover cheap
      show: false,
    },
    xAxis: { type: "value", name: "mean ΔAUC", min: 0, max: maxX || 1, ...AXIS },
    yAxis: { type: "category", data: names, ...AXIS },
    series: [
      {
        type: "bar",
        data: data.map((d) => d[0]),
        itemStyle: { color: "#4ea8de", borderRadius: [0, 3, 3, 0] },
        barWidth: "55%",
      },
      {
        type: "custom",
        renderItem: renderWhisker,
        data,
        z: 3,
        silent: true,
      },
    ],
  };

  const onEvents = useMemo(
    () => ({
      click: (p: { dataIndex: number }) => {
        // ordered is bottom-up; map back to the clicked feature.
        const f = ordered[p.dataIndex];
        if (f) setSelected(f);
      },
    }),
    [ordered],
  );

  return (
    <div className="diagnostics">
      <p className="diagnostics-caption">Permutation importance (mean ΔAUC ± std) — click a feature to investigate.</p>
      <ReactECharts
        option={option}
        onEvents={onEvents}
        style={{ height: Math.max(160, features.length * 44), width: "100%" }}
        notMerge
        theme="dark"
      />
      {selected && (
        <div className="diagnostics-actions" data-testid="diagnostics-actions">
          <span className="diagnostics-readout">{stabilityLabel(selected)}</span>
          <button
            type="button"
            onClick={() => sendMessage(`How does the feature "${selected.name}" relate to the target? It ranked among the top permutation-importance drivers.`)}
          >
            Ask Clair about {selected.name}
          </button>
          <button
            type="button"
            onClick={() => sendMessage(`Slice the target by "${selected.name}" — run a grouped SQL summary so I can see its effect.`)}
          >
            Slice by {selected.name}
          </button>
        </div>
      )}
    </div>
  );
}
