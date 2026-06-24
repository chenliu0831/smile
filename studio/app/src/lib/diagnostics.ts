/**
 * Pure parser for the Driver Diagnostics payload (S4, ADR-0011/0014).
 *
 * The daemon inlines the skill's `postprocess_results.json` verbatim into the diagnostics
 * artifact's `meta` (it never parses it — ADR-0014). The exact shape is agent-determined
 * and loosely specified by the skill, so this parser is DEFENSIVE: it hunts for a feature-
 * importance array under a few common keys and tolerates missing std / odd field names
 * without throwing (mirrors lib/leaderboard.ts's crash-safety discipline). React-free and
 * dependency-free so it is unit-tested directly.
 */

/** One driver: its mean importance and (optionally) the permutation std. */
export interface FeatureImportance {
  name: string;
  /** Mean importance (e.g. mean ΔAUC under permutation), OR a synthesized rank weight when
   * the source was only a ranked name list (see `ranked`). */
  mean: number;
  /** Permutation std, when the producer reported it (renders the whisker). */
  std?: number;
  /** True when `mean` is a synthesized rank weight (source was a plain ranked name list, no
   * magnitudes) — the chart labels the axis "rank" and shows no numeric ΔAUC for these. */
  ranked?: boolean;
}

const ARRAY_KEYS = ["top5_features", "top_features", "feature_importance", "importances", "features"];
const NAME_KEYS = ["feature", "name", "feature_name", "column"];
const MEAN_KEYS = ["mean", "importance", "value", "mean_importance", "delta_auc", "magnitude", "score"];
const STD_KEYS = ["std", "stddev", "std_dev", "sd", "error"];

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (k in obj) return obj[k];
  return undefined;
}

/** Find the importance array in an arbitrary meta object: a known key, else the first
 * array value (objects OR strings). Returns [] if none looks like feature rows. */
function findArray(meta: unknown): unknown[] {
  if (Array.isArray(meta)) return meta;
  if (!meta || typeof meta !== "object") return [];
  const obj = meta as Record<string, unknown>;
  for (const k of ARRAY_KEYS) {
    if (Array.isArray(obj[k])) return obj[k] as unknown[];
  }
  // Fallback: the first value that is an array of objects OR a non-empty array of strings.
  for (const v of Object.values(obj)) {
    if (Array.isArray(v) && v.length > 0 && v.some((x) => (x && typeof x === "object") || typeof x === "string")) {
      return v;
    }
  }
  return [];
}

/**
 * Parse `meta` into a list of driver importances, sorted by mean descending. Two shapes are
 * tolerated (observed in real runs):
 *  - objects: `{feature, mean, std}` (or alt key spellings) — the rich form.
 *  - a plain RANKED string array: `top5_features: ["Sex","Fare",...]` — no magnitudes, so we
 *    synthesize a descending rank weight (1.0, 0.8, …) purely for bar ordering, and mark the
 *    row `ranked` so the chart can label it "rank" not a real ΔAUC. std stays absent.
 * Rows without a usable name (or, for the object form, a finite mean) are skipped. Returns []
 * when nothing parseable is found (graceful absence).
 */
export function parseDiagnostics(meta: unknown): FeatureImportance[] {
  const arr = findArray(meta);

  // Plain ranked string array (no magnitudes).
  if (arr.length > 0 && arr.every((x) => typeof x === "string")) {
    const names = arr as string[];
    return names
      .filter((n) => n.trim().length > 0)
      .map((name, i) => ({ name, mean: 1 - i / Math.max(names.length, 1), ranked: true as const }));
  }

  const out: FeatureImportance[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = pick(row, NAME_KEYS);
    const mean = num(pick(row, MEAN_KEYS));
    if (typeof name !== "string" || !name || mean === undefined) continue;
    const std = num(pick(row, STD_KEYS));
    out.push({ name, mean, ...(std !== undefined ? { std } : {}) });
  }
  out.sort((a, b) => b.mean - a.mean);
  return out;
}

/** A plain-English stability read for a driver, used in the hover/tooltip line. */
export function stabilityLabel(f: FeatureImportance): string {
  if (f.ranked) return `${f.name}: top driver (rank only — no magnitude reported)`;
  if (f.std === undefined) return `${f.name}: importance ${f.mean.toFixed(3)}`;
  const ratio = f.mean === 0 ? Infinity : f.std / Math.abs(f.mean);
  const stability = ratio <= 0.25 ? "stable" : ratio >= 0.6 ? "noisy" : "moderate";
  return `${f.name}: ${f.mean.toFixed(3)} ± ${f.std.toFixed(3)} (${stability})`;
}
