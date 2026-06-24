/**
 * Pure parser for the Scorecard payload (S5, ADR-0011/0014).
 *
 * The daemon inlines the skill's `final_metrics.json` verbatim into the metrics artifact's
 * `meta` (ADR-0014). The skill's emitted shape is loosely specified, so this parser is
 * DEFENSIVE: it reads the framing fields (task_type, primary_metric, CV, rows) and a set of
 * headline scores under common key spellings, tolerating absence. React-free + dependency-
 * free → unit-tested directly.
 */
import type { ProblemType } from "./leaderboard";

export interface RunMetrics {
  /** The run's problem type, when reported — drives the Leaderboard's metric labels. */
  taskType?: ProblemType;
  /** The primary ranking metric name (e.g. "AUC"), when reported. */
  primaryMetric?: string;
  /** CV strategy text (e.g. "5-fold"), when reported. */
  cv?: string;
  /** Training row count, when reported. */
  rows?: number;
  /** The ensemble method (e.g. "weighted_average"), when reported. */
  ensembleMethod?: string;
  /** Headline scores: label → value (+ source field), in declared order, for the strip. */
  scores: { label: string; value: number; source: string }[];
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Map a free-form task_type string to the canonical ProblemType (else undefined). */
export function normalizeTaskType(raw: unknown): ProblemType | undefined {
  const s = str(raw)?.toLowerCase();
  if (!s) return undefined;
  if (s.includes("regress")) return "regression";
  if (s.includes("multi")) return "multiclass";
  if (s.includes("binary") || s.includes("classif")) return "binary";
  return undefined;
}

// Headline score fields, in display order, with their labels. Each lists the key spellings
// the skill might emit; the first present wins.
const SCORE_FIELDS: { label: string; keys: string[] }[] = [
  { label: "OOF", keys: ["oof_auc", "oof_score", "oof"] },
  { label: "TEST", keys: ["test_auc", "test_score", "test"] },
  { label: "ACC", keys: ["test_acc", "test_accuracy", "accuracy", "acc"] },
  { label: "F1", keys: ["test_f1", "f1"] },
  { label: "Brier", keys: ["brier", "brier_score"] },
];

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (k in obj) return obj[k];
  return undefined;
}

/**
 * Parse `meta` into a RunMetrics. Returns null only when there is nothing usable at all
 * (no framing AND no scores), so the Scorecard can hide gracefully.
 */
export function parseMetrics(meta: unknown): RunMetrics | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const obj = meta as Record<string, unknown>;

  const taskType = normalizeTaskType(pick(obj, ["task_type", "problem_type", "task"]));
  const primaryMetric = str(pick(obj, ["primary_metric", "metric"]));
  const cv = str(pick(obj, ["cv", "cv_strategy", "validation_strategy"]));
  const rows = num(pick(obj, ["rows", "n_rows", "n_train", "train_rows"]));
  const ensembleMethod = str(pick(obj, ["ensemble_method", "method", "ensemble"]));

  const scores: { label: string; value: number; source: string }[] = [];
  for (const f of SCORE_FIELDS) {
    const key = f.keys.find((k) => k in obj);
    const v = key !== undefined ? num(obj[key]) : undefined;
    if (key !== undefined && v !== undefined) scores.push({ label: f.label, value: v, source: key });
  }

  if (!taskType && !primaryMetric && rows === undefined && scores.length === 0) return null;
  return { taskType, primaryMetric, cv, rows, ensembleMethod, scores };
}
