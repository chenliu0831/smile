/**
 * Predictions Studio (S2, ADR-0011 / ADR-0013): the signature interactive surface over a
 * run's per-row prediction set. The daemon materializes final/submission.csv ONCE into the
 * shared DuckDB session; this view fetches the rows over /data/{ref} a single time, then
 * recomputes the confusion matrix, ROC operating point, and accuracy/precision/recall/F1
 * entirely client-side as the user drags the threshold slider — no per-drag network call.
 *
 * All metric math lives in the pure, unit-tested ../lib/predictions module; this component
 * is just fetch + ECharts + the slider. It renders only for a labelled binary prediction
 * set (a <target>_proba / <target>_actual column pair); other tables no-op (handled by the
 * Canvas dispatch via hasPredictionSchema).
 */
import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { Artifact } from "../daemon/protocol";
import {
  type ColumnTable,
  type CellKey,
  type PredictionRow,
  detectPredictionSchema,
  toPredictionRows,
  confusionAt,
  metricsFrom,
  rocCurve,
  aucFrom,
  thresholdMaximisingF1,
  rowsInCell,
  separationHistogram,
} from "../lib/predictions";

const AXIS = { axisLine: { lineStyle: { color: "#2a3340" } }, axisLabel: { color: "#8b98a8" } };
const BASE = {
  backgroundColor: "transparent",
  textStyle: { color: "#e6edf3", fontFamily: "inherit" },
  title: { left: "center", textStyle: { color: "#e6edf3", fontSize: 13 } },
};

/** Whether an artifact is a prediction-set dataframe Predictions Studio can render. */
export function isPredictionsArtifact(a: Artifact): boolean {
  return a.kind === "dataframe" && a.data?.kind === "arrow";
}

function pct(x: number): string {
  return Number.isFinite(x) ? x.toFixed(3) : "—";
}

export function PredictionsStudio({ table }: { table: ColumnTable | undefined }) {
  const schema = useMemo(() => detectPredictionSchema(table), [table]);
  const rows = useMemo(
    () => (table && schema ? toPredictionRows(table, schema) : []),
    [table, schema],
  );
  const roc = useMemo(() => rocCurve(rows), [rows]);
  const auc = useMemo(() => aucFrom(roc), [roc]);

  // The slider opens at the model's real operating point (0.50), NOT the F1-optimal one —
  // tuning the threshold on the hold-out is in-sample (ADR-0011 honesty note).
  const [threshold, setThreshold] = useState(0.5);

  const confusion = useMemo(() => confusionAt(rows, threshold), [rows, threshold]);
  const metrics = useMemo(() => metricsFrom(confusion), [confusion]);

  // Drill-down: the confusion cell the user clicked, and the rows in it at this threshold.
  const [selectedCell, setSelectedCell] = useState<CellKey | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const cellRows = useMemo(
    () => (selectedCell ? rowsInCell(rows, selectedCell, threshold) : []),
    [rows, selectedCell, threshold],
  );
  const histogram = useMemo(() => separationHistogram(rows, 10), [rows]);

  // Moving the threshold invalidates the current cell selection (membership changes).
  const selectCell = (cell: CellKey) => {
    setSelectedCell(cell);
    setExpandedRow(null);
  };

  // The ROC operating point at the current threshold (for the curve marker).
  const operating = useMemo(() => {
    const positives = rows.reduce((n, r) => n + r.actual, 0);
    const negatives = rows.length - positives;
    if (!positives || !negatives) return null;
    return { fpr: confusion.fp / negatives, tpr: confusion.tp / positives };
  }, [rows, confusion]);

  // Predictions Studio renders ABOVE the data grid (Canvas pairs them). When there's nothing
  // to plot — no table yet, or this dataframe isn't a labelled binary prediction set
  // (no proba+truth) — render NOTHING and let the grid below carry the data.
  if (!table || !schema || rows.length === 0 || roc.length === 0) {
    return null;
  }

  const rocOption = {
    ...BASE,
    title: { ...BASE.title, text: `ROC — AUC ${pct(auc)}` },
    grid: { left: 48, right: 16, top: 40, bottom: 36 },
    xAxis: { type: "value", name: "FPR", min: 0, max: 1, ...AXIS },
    yAxis: { type: "value", name: "TPR", min: 0, max: 1, ...AXIS },
    series: [
      {
        type: "line", smooth: false, showSymbol: false,
        lineStyle: { color: "#4ea8de", width: 2 },
        areaStyle: { color: "rgba(78,168,222,0.10)" },
        data: roc.map((p) => [p.fpr, p.tpr]),
      },
      // Chance diagonal.
      {
        type: "line", showSymbol: false, silent: true,
        lineStyle: { color: "#2a3340", width: 1, type: "dashed" },
        data: [[0, 0], [1, 1]],
      },
      // The operating point at the current threshold.
      ...(operating ? [{
        type: "scatter", symbolSize: 11,
        itemStyle: { color: "#e3b341" },
        data: [[operating.fpr, operating.tpr]],
      }] : []),
    ],
  };

  // Confusion as a 2x2 heatmap. x = predicted (0,1), y = actual (0,1).
  const cells = [
    [0, 1, confusion.tn], [1, 1, confusion.fp],
    [0, 0, confusion.fn], [1, 0, confusion.tp],
  ];
  const maxCell = Math.max(confusion.tp, confusion.fp, confusion.tn, confusion.fn, 1);
  const confusionOption = {
    ...BASE,
    title: { ...BASE.title, text: `Confusion @ ${threshold.toFixed(2)}` },
    grid: { left: 60, right: 16, top: 40, bottom: 40 },
    xAxis: { type: "category", data: ["pred 0", "pred 1"], ...AXIS },
    yAxis: { type: "category", data: ["act 1", "act 0"], ...AXIS },
    visualMap: { min: 0, max: maxCell, show: false, inRange: { color: ["#16314a", "#4ea8de"] } },
    series: [{
      type: "heatmap",
      data: cells,
      label: { show: true, color: "#e6edf3", fontSize: 14 },
    }],
  };

  // Map a clicked heatmap point [x=pred, y(0→act1,1→act0)] back to a confusion cell.
  const CELL_AT: Record<string, CellKey> = {
    "1,0": "tp", "0,0": "fn", // y=0 → actual 1
    "1,1": "fp", "0,1": "tn", // y=1 → actual 0
  };
  const onConfusionEvents = {
    click: (p: { data?: number[] }) => {
      if (!p.data) return;
      const key = CELL_AT[`${p.data[0]},${p.data[1]}`];
      if (key) selectCell(key);
    },
  };

  // Probability-separation histogram: actual-0 vs actual-1 counts per probability bin.
  const histOption = {
    ...BASE,
    title: { ...BASE.title, text: "Probability separation by class" },
    grid: { left: 48, right: 16, top: 40, bottom: 36 },
    legend: { top: 16, right: 8, textStyle: { color: "#8b98a8" }, data: ["actual 0", "actual 1"] },
    tooltip: { trigger: "axis" as const },
    xAxis: { type: "category", data: histogram.map((b) => b.lo.toFixed(1)), name: "proba", ...AXIS },
    yAxis: { type: "value", name: "count", ...AXIS },
    series: [
      { name: "actual 0", type: "bar", stack: "c", itemStyle: { color: "#5a6b7d" }, data: histogram.map((b) => b.neg) },
      { name: "actual 1", type: "bar", stack: "c", itemStyle: { color: "#4ea8de" }, data: histogram.map((b) => b.pos) },
    ],
  };

  const CELL_LABEL: Record<CellKey, string> = {
    tp: "true positives", fp: "false positives", tn: "true negatives", fn: "false negatives",
  };
  // Feature columns to show in the row inspector (everything except the proba/actual pair).
  const featureCols = (r: PredictionRow) =>
    Object.keys(r.values).filter((c) => c !== schema.probaCol && c !== schema.actualCol);

  return (
    <div className="predictions-studio">
      <div className="predictions-controls">
        <label>
          Threshold <b>{threshold.toFixed(2)}</b>
          <input
            type="range" min={0} max={1} step={0.01} value={threshold}
            onChange={(e) => { setThreshold(Number(e.target.value)); setExpandedRow(null); }}
          />
        </label>
        <button
          type="button"
          className="predictions-whatif"
          title="In-sample on the hold-out — a what-if, not a validated operating point."
          onClick={() => setThreshold(Number(thresholdMaximisingF1(rows).toFixed(2)))}
        >
          Maximize F1 (what-if)
        </button>
      </div>

      <div className="predictions-metrics" data-testid="predictions-metrics">
        <span>acc <b>{pct(metrics.accuracy)}</b></span>
        <span>prec <b>{pct(metrics.precision)}</b></span>
        <span>rec <b>{pct(metrics.recall)}</b></span>
        <span>F1 <b>{pct(metrics.f1)}</b></span>
        <span className="predictions-note">recomputed from hold-out</span>
      </div>

      <div className="predictions-charts">
        <ReactECharts option={confusionOption} onEvents={onConfusionEvents} style={{ height: 260, width: "50%" }} notMerge theme="dark" />
        <ReactECharts option={rocOption} style={{ height: 260, width: "50%" }} notMerge theme="dark" />
      </div>

      <ReactECharts option={histOption} style={{ height: 220, width: "100%" }} notMerge theme="dark" />

      {selectedCell && (
        <div className="predictions-drill" data-testid="predictions-drill">
          <div className="predictions-drill-head">
            {cellRows.length} {CELL_LABEL[selectedCell]} @ {threshold.toFixed(2)}
            <button type="button" className="predictions-drill-close" onClick={() => setSelectedCell(null)}>✕</button>
          </div>
          <ul className="predictions-rowlist">
            {cellRows.slice(0, 50).map((r) => (
              <li key={r.index}>
                <button
                  type="button"
                  className="predictions-row"
                  onClick={() => setExpandedRow(expandedRow === r.index ? null : r.index)}
                >
                  row {r.index} · proba {r.proba.toFixed(3)} · actual {r.actual}
                </button>
                {expandedRow === r.index && (
                  <dl className="predictions-features" data-testid="predictions-features">
                    {featureCols(r).map((c) => (
                      <span key={c}><dt>{c}</dt><dd>{String(r.values[c])}</dd></span>
                    ))}
                  </dl>
                )}
              </li>
            ))}
            {cellRows.length > 50 && <li className="predictions-more">… {cellRows.length - 50} more</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
