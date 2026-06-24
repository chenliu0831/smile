# S7 — Per-Candidate hyperparameter drill-down

> ready-for-agent · PRD: ../PRD-explorable-automl-cockpit.md · ADR-0011, ADR-0014

## What to build

Make a **Leaderboard** row expandable to its tuned hyperparameters. Like the Scorecard's metrics, the structured params do not exist as a file today (the doc's assumed `best_params.json` is not emitted — params live only in `automl_report.md` prose and `solution_vN_tuned.py`), so this slice carries a skill-sidecar overlay.

End-to-end: extend the automl skill (via `ioa-overlay/`) to emit a public tuned-hyperparameters sidecar, keyed by the agent's own model names (`xgb`/`lgbm`/`rf`) to sidestep the `xgb` ≠ `xgboost` join bug. The watcher surfaces it as a companion artifact (JSON inline in `meta`). Expanding a **Leaderboard** row shows that model's tuned params with a "copy as Python dict" action and a default-vs-tuned delta. Badge models that exist only in a tuned form (e.g. logreg/mlp "tuned only").

## Acceptance criteria

- [x] The overlaid skill emits a public tuned-hyperparameters sidecar keyed by the agent's model names.
- [x] The watcher surfaces it as a companion artifact with params inline in `meta`.
- [x] Expanding a **Leaderboard** row shows that **Candidate**'s tuned params, a "copy as Python dict" action, and a default-vs-tuned delta.
- [x] Models present only in a tuned form are badged accordingly; rows without params expand gracefully.
- [x] A replay-fixture UAT asserts a row expands to show params from a captured companion artifact.

## Blocked by

- S6 — Interactive Leaderboard
- S1 — `meta` field prefactor

**Status: complete.** SKILL.md overlay item-8 emits best_params.json keyed by short model names; watcher surfaces it as a metrics-kind companion (ref=params, not a canvas tab); lib/params joins to rows (candidate_/substring tolerant), renders tuned-vs-default delta + copy-as-Python-dict. Companion artifacts filtered from Canvas tabs (also fixes the S5 stray metrics tab). Verified: app 138 tests + tsc clean; serve watcher/conformance pass.
