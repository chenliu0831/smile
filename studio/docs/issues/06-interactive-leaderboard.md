# S6 — Interactive Leaderboard (summary.md, sort, score bars, verdict)

> ready-for-agent · PRD: ../PRD-explorable-automl-cockpit.md · ADR-0004 (rendering guidance)

## What to build

Make the **Leaderboard** show the full picture and become interactive — a zero-backend slice on already-surfaced data.

End-to-end: repoint the **Leaderboard** parser at the merged ranking (`summary.md`, which already *is* the 10-row merged table including tuned models and ensembles) instead of only the five default candidates; teach the parser its column layout. Add sortable columns, horizontal score bars color-coded by model type (gold = ensemble, blue = tuned, grey = default), and conditional ±std whiskers rendered only where std is finite. Add a grouped verdict block showing the weighted-average ensemble beat every base learner *and* stacking.

Pin every displayed number to a single source and compute lift client-side so the arithmetic always reconciles (the run's files disagree on per-model AUC across tuning-CV / OOF / default).

## Acceptance criteria

- [x] The **Leaderboard** renders all rows from the merged ranking (defaults, tuned, ensembles), not just the five default **Candidates**.
- [x] Columns are sortable; each row shows a score bar color-coded by model type.
- [x] ±std whiskers render only where std is finite (tuned/ensemble rows with no std show none).
- [x] A verdict block summarizes ensemble-vs-base-learners and ensemble-vs-stacking.
- [x] Every displayed number traces to a single pinned source; lift is computed client-side and reconciles.
- [x] The pure parser is unit-tested (parse + sort + malformed-input crash-safety), following the existing leaderboard-parser test prior art.

## Blocked by

- None — can start immediately.

**Status: complete.** Sortable columns, type-colored score bars, ±std whiskers (finite only), ensemble verdict. Pure helpers (classifyModel/sortCandidates/ensembleVerdict) unit-tested; problemType prop defaults to binary (S5 threads real task_type). Verified: app 113 tests + tsc clean.
