/**
 * Parses the `automl` skill's `candidate_scores.md` markdown table into a ranked,
 * sortable Leaderboard (ADR-0004 rendering guidance, ADR-0005). A projection of an
 * agent artifact — not a backend-owned table.
 */

/** How a row was produced — drives the score-bar colour and the ensemble verdict. */
export type ModelType = "ensemble" | "tuned" | "default";

export interface Candidate {
  name: string;
  score: number;
  std?: number;
  params?: string;
  runtimeSec?: number;
  notes?: string;
  /** Classified from the row's name + notes (ensemble > tuned > default). */
  modelType: ModelType;
}

export interface Leaderboard {
  /** The ranking metric, e.g. "AUC", "RMSE". */
  metric: string;
  higherIsBetter: boolean;
  /** Candidate rows, ranked best-first. */
  rows: Candidate[];
}

export interface MetricSpec {
  metric: string;
  higherIsBetter: boolean;
}

export type ProblemType = "binary" | "multiclass" | "regression";

/** The default ranking metric per problem type (ADR-0004). */
export function defaultMetric(problem: ProblemType): MetricSpec {
  switch (problem) {
    case "binary":
      return { metric: "AUC", higherIsBetter: true };
    case "multiclass":
      return { metric: "mean-per-class-error", higherIsBetter: false };
    case "regression":
      return { metric: "RMSE", higherIsBetter: false };
  }
}

/** Classify a row as ensemble / tuned / default from its name + notes (ensemble wins ties). */
export function classifyModel(name: string, notes?: string): ModelType {
  const hay = `${name} ${notes ?? ""}`.toLowerCase();
  if (/\bensemble\b|\bstack|\bblend|weighted[ _-]?av|hill[ _-]?climb/.test(hay)) return "ensemble";
  if (/\btuned\b|\btuning\b|\bablation\b|\boptuna\b|\bhyperparam/.test(hay)) return "tuned";
  return "default";
}

/** A column the interactive board can sort by. */
export type SortKey = "score" | "name" | "runtimeSec";

/**
 * Re-rank rows by an arbitrary column. `score` honours the metric direction
 * (higherIsBetter); `name` is alphabetical; `runtimeSec` is ascending (missing last).
 * Pure — the component holds the active key in state and calls this on each render.
 */
export function sortCandidates(rows: Candidate[], key: SortKey, higherIsBetter: boolean): Candidate[] {
  const out = rows.slice();
  out.sort((a, b) => {
    if (key === "name") return a.name.localeCompare(b.name);
    if (key === "runtimeSec") {
      const av = a.runtimeSec ?? Infinity;
      const bv = b.runtimeSec ?? Infinity;
      return av - bv;
    }
    return higherIsBetter ? b.score - a.score : a.score - b.score;
  });
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function parseLeaderboard(markdown: string, spec: MetricSpec): Leaderboard {
  const lines = markdown.split("\n").map((l) => l.trim());
  const rows: Candidate[] = [];
  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    const cells = splitRow(line);
    if (cells.length < 2 || !cells[0]) continue;            // malformed/empty row
    // Skip the header row and the |---|---| separator.
    if (cells[0].toLowerCase() === "candidate") continue;
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    const score = Number(cells[1]);
    if (!Number.isFinite(score)) continue;                  // non-numeric / empty score cell
    const std = cells[2] ? Number(cells[2]) : undefined;
    const runtimeSec = cells[4] ? Number(cells[4]) : undefined;
    const notes = cells[5] || undefined;
    rows.push({
      name: cells[0],
      score,
      std: Number.isFinite(std as number) ? std : undefined,
      params: cells[3] || undefined,
      runtimeSec: Number.isFinite(runtimeSec as number) ? runtimeSec : undefined,
      notes,
      modelType: classifyModel(cells[0], notes),
    });
  }
  rows.sort((a, b) => (spec.higherIsBetter ? b.score - a.score : a.score - b.score));
  return { metric: spec.metric, higherIsBetter: spec.higherIsBetter, rows };
}

/** The ensemble-vs-base-learners verdict, computed client-side so the arithmetic always
 * reconciles (the source files disagree on per-model scores; we pin to THIS board's rows).
 * Returns null when the board has no ensemble row or no base learner to compare against. */
export interface EnsembleVerdict {
  ensemble: Candidate;
  bestBase: Candidate;
  /** Signed lift of the ensemble over the best base learner, in metric direction. */
  lift: number;
  beatsBest: boolean;
}

export function ensembleVerdict(board: Leaderboard): EnsembleVerdict | null {
  const ensemble = board.rows.find((r) => r.modelType === "ensemble");
  if (!ensemble) return null;
  const bases = board.rows.filter((r) => r.modelType !== "ensemble");
  if (bases.length === 0) return null;
  const bestBase = bases.reduce((best, r) =>
    (board.higherIsBetter ? r.score > best.score : r.score < best.score) ? r : best,
  );
  const lift = board.higherIsBetter
    ? ensemble.score - bestBase.score
    : bestBase.score - ensemble.score;
  return { ensemble, bestBase, lift, beatsBest: lift > 0 };
}
