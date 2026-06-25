# In-report table charts, parsed frontend-side

## Status

accepted

## Context

The agent's report artifacts (`automl_report.md`, `model_evaluation_report.md`, …) are dense
with numeric GFM tables — candidate comparisons, refinement history, OOF metrics. Today
`Markdown.tsx` renders these as flat HTML `<table>`s; the numbers never become a visual.
We wanted incoming reports to auto-chart their tables.

## Decision

A chartable numeric table inside a report renders an inline native ECharts bar **in place,
directly below the rendered table**, in the narrative flow — and the **frontend parses the
markdown** to produce it. No agent or daemon change.

Three sub-decisions:

1. **Frontend parses the markdown, the agent emits nothing new.** The whole AutoML robustness
   effort (ADRs/CONTEXT, the watcher's aliasing/backfill/stub-skip) exists because the agent
   does *not* reliably honor exact output contracts. Adding a new chart-spec file contract
   (the ADR-0014 sidecar pattern) would reintroduce exactly that drift. Parsing the markdown
   the agent actually produced is robust to format/filename drift and ships with zero backend
   surface. The cost — heuristics decide what is "chartable" — is contained in one pure,
   crash-safe `lib/` module (`reportCharts.ts`), mirroring `lib/leaderboard.ts`.

2. **Chart in place; do NOT cross-reference and suppress.** Several report tables duplicate
   dedicated cockpit surfaces (Candidate Comparison ≈ Leaderboard, OOF metrics ≈ Scorecard,
   confusion matrix ≈ Predictions Studio). This is **not** the duplication ADR-0007/the
   `duplicatesNativeSurface` watcher logic suppresses — those were *separate top-level PNG
   artifacts* competing with interactive surfaces for the canvas. An in-report chart enriches
   the document you are already reading, where the numbers already are. Trying to classify
   "this table is the leaderboard" is fragile and would strip charts from the report's
   headline tables. So: any numeric table → chart, no suppression.

3. **Bar of the first numeric column, with a column-picker; never multi-series.** Report
   tables mix scales in adjacent columns (AUC ≈ 0.88 next to Log-loss ≈ 0.39 next to
   "+0.32 %"). A grouped multi-series bar would be misleading (a 0.4 bar dwarfs a 0.005 bar).
   We default to a horizontal bar of the **first** numeric column vs the label column —
   always legible — and add a small dropdown so the user can switch which numeric column is
   plotted. Automated-first (the chart just appears, no config), with depth one click away
   (the tenet: easy things simple, complex things possible).

## Consequences

- Confusion-matrix tables appear in reports as fenced code blocks / inline `[[493,56],…]`,
  not GFM pipe tables, so they are naturally not charted — and they have Predictions Studio.
- The chart's data is inline (already parsed from the markdown), so unlike `Chart.tsx` /
  `DataVizSpec` it does **not** fetch `/data/{ref}`. The by-reference `viz` path is untouched.
- "Chartable" = a GFM table with a label column (first non-numeric) and ≥1 numeric column.
  A table that is all-text or all-numeric (no label) renders as a table only, no chart.
