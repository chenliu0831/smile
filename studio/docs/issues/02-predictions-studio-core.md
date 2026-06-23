# S2 — Predictions Studio (core: threshold slider, confusion matrix, ROC)

> ready-for-agent · PRD: ../PRD-explorable-automl-cockpit.md · ADR-0011, ADR-0013

## What to build

The signature interactive surface, as a complete vertical slice with **no contract change** (it reuses the existing `dataframe` kind and the `data` → **Arrow Frame** reference).

End-to-end: the `RunArtifactWatcher` exposes `final/submission.csv` as a `dataframe` **Artifact** — the daemon materializes it once with a DuckDB `CREATE OR REPLACE VIEW` and the rows are served via the existing `/data/{ref}` path (materialize-once; **no per-interaction round-trip**, per ADR-0011). A new **Predictions Studio** branch in the canvas's per-artifact dispatch renders a two-pane view: a 2×2 confusion matrix beside a ROC curve, both recomputed in the browser as the user drags one threshold slider, with live accuracy / precision / recall / F1 readouts. All metric math lives in a new pure, React-free `lib/` module (ROC sweep, confusion-at-threshold, F1/accuracy/precision/recall) that takes the in-memory prediction rows and returns derived values; the slider recompute never touches the network. Visuals render with ECharts (ROC = line/scatter with the operating point marked; confusion = heatmap).

Honesty framing is part of the slice: the slider opens at the model's real operating point (~0.50, not a hallucinated value); a "Maximize F1" affordance is labeled a what-if, *not validated* (in-sample on the hold-out); client-computed metrics are labeled "recomputed from hold-out" and anchored to the daemon's own test AUC/F1. The branch gates on the `*_proba`/`*_actual` schema so it cleanly does not appear for regression/unlabeled runs.

## Acceptance criteria

- [x] The watcher emits a `dataframe` **Artifact** for `final/submission.csv`, backed by a DuckDB table, served over `/data/{ref}`. (Materialized via `CREATE OR REPLACE TABLE submission AS read_csv_auto(...)` — a TABLE not a VIEW, see note — with graceful fallback to the path-only `file` artifact when the SQL bridge is unavailable.)
- [x] A pure `lib/` module (`lib/predictions.ts`) computes ROC points, confusion-at-threshold, and accuracy/precision/recall/F1 from prediction rows; tolerates malformed/edge input without throwing. (9 unit tests.)
- [x] Dragging the threshold slider recomputes the confusion matrix, ROC operating point, and the four metric readouts entirely client-side (UAT asserts exactly one `/data/{ref}` fetch across the drag).
- [x] The slider opens at the model's real ~0.50 operating point; "Maximize F1" is a labeled what-if; metrics are labeled "recomputed from hold-out".
- [x] The view does not render for a run lacking the `*_proba`/`*_actual` schema (`detectPredictionSchema` returns null → no-op message).
- [x] A replay-fixture UAT (`uat-predictions-studio.test.tsx`) drives the frontend from a transcript carrying the predictions artifact and asserts the panel renders and the slider recomputes.

**Status: complete.** Verified: app 22 files / 108 tests + `tsc` clean; serve watcher/conformance/scripted tests pass.

**Deviation from ADR-0011 wording:** the ADR said `CREATE VIEW`; implemented as `CREATE OR REPLACE TABLE` because `duckdb_tables()` (which `SessionTables.exists` → `/data/{ref}` resolve against) lists tables, not views — a view would be invisible to the data endpoint. A table is also more faithful to "materialize once" (the CSV is read once, not re-scanned per fetch). Same shared-session, same ADR intent.

## Blocked by

- None — can start immediately.
