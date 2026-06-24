/**
 * Pure parser for the per-Candidate hyperparameter sidecar (S7, ADR-0011/0014).
 *
 * The automl skill overlay emits `output/best_params.json`, keyed by the agent's own model
 * names (`xgb`/`lgbm`/`rf`) to sidestep the `xgb` ≠ `xgboost` join bug. The daemon inlines it
 * verbatim into a companion artifact's `meta`; this parses it and joins to Leaderboard rows
 * by name. Defensive (the agent authors the JSON), React-free, unit-tested directly.
 *
 * Expected shape (best-effort — any subset tolerated):
 *   { "xgb": { "params": {...}, "default_params": {...} }, "lgbm": { "params": {...} }, ... }
 * A bare `{ "xgb": {...params...} }` (no nesting) is also accepted as the tuned params.
 */

export interface ModelParams {
  /** Tuned hyperparameters (name → value). */
  params: Record<string, number | string | boolean>;
  /** Default hyperparameters, when reported — enables the default-vs-tuned delta. */
  defaults?: Record<string, number | string | boolean>;
}

/** Parsed params keyed by (lower-cased) model name. */
export type ParamsByModel = Record<string, ModelParams>;

function isScalarRecord(v: unknown): v is Record<string, number | string | boolean> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v).every((x) => ["number", "string", "boolean"].includes(typeof x));
}

/** Parse the meta payload into per-model params. Returns {} when nothing is parseable. */
export function parseParams(meta: unknown): ParamsByModel {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  const out: ParamsByModel = {};
  for (const [model, raw] of Object.entries(meta as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    // Nested { params, default_params } form.
    if (isScalarRecord(obj.params)) {
      const entry: ModelParams = { params: obj.params };
      const defaults = obj.default_params ?? obj.defaults;
      if (isScalarRecord(defaults)) entry.defaults = defaults;
      out[model.toLowerCase()] = entry;
    } else if (isScalarRecord(obj)) {
      // Bare params form: the value IS the params map.
      out[model.toLowerCase()] = { params: obj };
    }
  }
  return out;
}

/** Match a Leaderboard row name to a params key, tolerating `candidate_xgb` ↔ `xgb` etc. */
export function paramsForModel(byModel: ParamsByModel, rowName: string): ModelParams | undefined {
  const n = rowName.toLowerCase();
  if (byModel[n]) return byModel[n];
  // Try stripping a leading "candidate_" and matching any key contained in the row name.
  const stripped = n.replace(/^candidate[_-]/, "");
  if (byModel[stripped]) return byModel[stripped];
  for (const key of Object.keys(byModel)) {
    if (n.includes(key)) return byModel[key];
  }
  return undefined;
}

/** Render a params map as a copy-pasteable Python dict literal. */
export function toPythonDict(params: Record<string, number | string | boolean>): string {
  const body = Object.entries(params)
    .map(([k, v]) => {
      const val = typeof v === "string" ? `'${v}'` : typeof v === "boolean" ? (v ? "True" : "False") : String(v);
      return `    '${k}': ${val},`;
    })
    .join("\n");
  return `{\n${body}\n}`;
}

/** One row of the default-vs-tuned comparison. */
export interface ParamDelta {
  key: string;
  tuned: number | string | boolean;
  default?: number | string | boolean;
  changed: boolean;
}

/** Compare tuned params against defaults (when present), flagging changed keys. */
export function paramDeltas(p: ModelParams): ParamDelta[] {
  const keys = [...new Set([...Object.keys(p.params), ...Object.keys(p.defaults ?? {})])].sort();
  return keys.map((key) => {
    const tuned = p.params[key];
    const def = p.defaults?.[key];
    return { key, tuned, default: def, changed: p.defaults !== undefined && tuned !== def };
  });
}
