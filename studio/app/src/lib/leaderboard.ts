/**
 * Parses the `automl` skill's `candidate_scores.md` markdown table into a ranked,
 * sortable Leaderboard (ADR-0004 rendering guidance, ADR-0005). A projection of an
 * agent artifact — not a backend-owned table.
 */

export interface Candidate {
  name: string;
  score: number;
  std?: number;
  params?: string;
  runtimeSec?: number;
  notes?: string;
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
    rows.push({
      name: cells[0],
      score,
      std: Number.isFinite(std as number) ? std : undefined,
      params: cells[3] || undefined,
      runtimeSec: Number.isFinite(runtimeSec as number) ? runtimeSec : undefined,
      notes: cells[5] || undefined,
    });
  }
  rows.sort((a, b) => (spec.higherIsBetter ? b.score - a.score : a.score - b.score));
  return { metric: spec.metric, higherIsBetter: spec.higherIsBetter, rows };
}
