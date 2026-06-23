/**
 * Pure prediction-set analytics for Predictions Studio (S2, ADR-0011).
 *
 * The daemon materializes `final/submission.csv` once (a DuckDB table served as a
 * column-oriented table over /data/{ref}); ALL interactive metric math runs here in the
 * browser, so dragging the threshold slider never hits the network. React-free and
 * dependency-free so it is unit-tested directly (mirrors lib/leaderboard.ts).
 *
 * The prediction set is detected by a `<target>_proba` / `<target>_actual` column pair
 * (the automl skill's submission schema). A run lacking that pair is not a labelled
 * binary-classification prediction set, so detection returns null and the view no-ops.
 */

/** A column-oriented table as /data/{ref} returns it: column name -> values. */
export type ColumnTable = Record<string, (number | string)[]>;

/** The detected probability/label columns of a binary prediction set. */
export interface PredictionSchema {
  /** The `<target>_proba` column name (predicted positive-class probability). */
  probaCol: string;
  /** The `<target>_actual` column name (true 0/1 label). */
  actualCol: string;
  /** The target stem (e.g. "Survived"), for labels. */
  target: string;
}

/** One prediction row: positive-class probability and the true label. */
export interface PredictionRow {
  proba: number;
  actual: 0 | 1;
}

/** The 2x2 confusion counts at a threshold (predicted positive iff proba >= threshold). */
export interface Confusion {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

/** Scalar metrics derived from a confusion matrix. */
export interface Metrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
}

/** A point on the ROC curve plus the threshold that produced it. */
export interface RocPoint {
  fpr: number;
  tpr: number;
  threshold: number;
}

/**
 * Detect the `<target>_proba` / `<target>_actual` column pair, if present. Returns null
 * when no such pair exists (regression, unlabelled, or non-prediction tables) so the
 * caller can cleanly not render Predictions Studio.
 */
export function detectPredictionSchema(table: ColumnTable | undefined): PredictionSchema | null {
  if (!table) return null;
  const cols = Object.keys(table);
  for (const probaCol of cols) {
    const m = /^(.+)_proba$/.exec(probaCol);
    if (!m) continue;
    const target = m[1];
    const actualCol = `${target}_actual`;
    if (cols.includes(actualCol)) return { probaCol, actualCol, target };
  }
  return null;
}

/**
 * Build the in-memory prediction rows from the column table for a detected schema. Rows
 * with a non-finite probability or a label that isn't 0/1 are skipped (crash-safety against
 * malformed agent output), so callers never see NaN propagate into the metric math.
 */
export function toPredictionRows(table: ColumnTable, schema: PredictionSchema): PredictionRow[] {
  const probas = table[schema.probaCol] ?? [];
  const actuals = table[schema.actualCol] ?? [];
  const n = Math.min(probas.length, actuals.length);
  const rows: PredictionRow[] = [];
  for (let i = 0; i < n; i++) {
    const proba = Number(probas[i]);
    const actual = Number(actuals[i]);
    if (!Number.isFinite(proba)) continue;
    if (actual !== 0 && actual !== 1) continue;
    rows.push({ proba, actual: actual as 0 | 1 });
  }
  return rows;
}

/** Confusion counts at `threshold`: predicted positive iff proba >= threshold. */
export function confusionAt(rows: PredictionRow[], threshold: number): Confusion {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const r of rows) {
    const predPos = r.proba >= threshold;
    if (r.actual === 1) {
      if (predPos) tp++; else fn++;
    } else {
      if (predPos) fp++; else tn++;
    }
  }
  return { tp, fp, tn, fn };
}

/** Accuracy/precision/recall/F1 from a confusion matrix (0 when the denominator is 0). */
export function metricsFrom(c: Confusion): Metrics {
  const total = c.tp + c.fp + c.tn + c.fn;
  const accuracy = total === 0 ? 0 : (c.tp + c.tn) / total;
  const precision = c.tp + c.fp === 0 ? 0 : c.tp / (c.tp + c.fp);
  const recall = c.tp + c.fn === 0 ? 0 : c.tp / (c.tp + c.fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { accuracy, precision, recall, f1 };
}

/**
 * The full ROC curve: sweep every distinct probability as a threshold and record
 * (fpr, tpr). Sorted by fpr ascending and bracketed with the trivial (0,0)/(1,1) endpoints
 * so the rendered curve spans the unit square. O(n log n) over the prediction rows — run
 * once when the rows load, not per slider drag.
 */
export function rocCurve(rows: PredictionRow[]): RocPoint[] {
  const positives = rows.reduce((n, r) => n + (r.actual === 1 ? 1 : 0), 0);
  const negatives = rows.length - positives;
  if (positives === 0 || negatives === 0) return [];

  // Distinct thresholds, descending, so the curve is traced from (0,0) toward (1,1).
  const thresholds = [...new Set(rows.map((r) => r.proba))].sort((a, b) => b - a);
  const points: RocPoint[] = [{ fpr: 0, tpr: 0, threshold: Infinity }];
  for (const threshold of thresholds) {
    const c = confusionAt(rows, threshold);
    points.push({ fpr: c.fp / negatives, tpr: c.tp / positives, threshold });
  }
  points.push({ fpr: 1, tpr: 1, threshold: -Infinity });
  return points;
}

/** Area under the ROC curve via the trapezoidal rule over the swept points. */
export function aucFrom(roc: RocPoint[]): number {
  let area = 0;
  for (let i = 1; i < roc.length; i++) {
    const dx = roc[i].fpr - roc[i - 1].fpr;
    area += (dx * (roc[i].tpr + roc[i - 1].tpr)) / 2;
  }
  return area;
}

/**
 * The threshold that maximises F1 over the swept thresholds. This is an IN-SAMPLE
 * what-if on the hold-out (ADR-0011 honesty note) — the UI labels it as such; it is not a
 * validated operating point.
 */
export function thresholdMaximisingF1(rows: PredictionRow[]): number {
  const thresholds = [...new Set(rows.map((r) => r.proba))].sort((a, b) => a - b);
  let best = 0.5;
  let bestF1 = -1;
  for (const t of thresholds) {
    const f1 = metricsFrom(confusionAt(rows, t)).f1;
    if (f1 > bestF1) {
      bestF1 = f1;
      best = t;
    }
  }
  return best;
}
