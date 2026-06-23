# S2 — Predictions Studio (core: threshold slider, confusion matrix, ROC)

> ready-for-agent · PRD: ../PRD-explorable-automl-cockpit.md · ADR-0011, ADR-0013

## What to build

The signature interactive surface, as a complete vertical slice with **no contract change** (it reuses the existing `dataframe` kind and the `data` → **Arrow Frame** reference).

End-to-end: the `RunArtifactWatcher` exposes `final/submission.csv` as a `dataframe` **Artifact** — the daemon materializes it once with a DuckDB `CREATE OR REPLACE VIEW` and the rows are served via the existing `/data/{ref}` path (materialize-once; **no per-interaction round-trip**, per ADR-0011). A new **Predictions Studio** branch in the canvas's per-artifact dispatch renders a two-pane view: a 2×2 confusion matrix beside a ROC curve, both recomputed in the browser as the user drags one threshold slider, with live accuracy / precision / recall / F1 readouts. All metric math lives in a new pure, React-free `lib/` module (ROC sweep, confusion-at-threshold, F1/accuracy/precision/recall) that takes the in-memory prediction rows and returns derived values; the slider recompute never touches the network. Visuals render with ECharts (ROC = line/scatter with the operating point marked; confusion = heatmap).

Honesty framing is part of the slice: the slider opens at the model's real operating point (~0.50, not a hallucinated value); a "Maximize F1" affordance is labeled a what-if, *not validated* (in-sample on the hold-out); client-computed metrics are labeled "recomputed from hold-out" and anchored to the daemon's own test AUC/F1. The branch gates on the `*_proba`/`*_actual` schema so it cleanly does not appear for regression/unlabeled runs.

## Acceptance criteria

- [ ] The watcher emits a `dataframe` **Artifact** for `final/submission.csv`, backed by a DuckDB view, served over `/data/{ref}` as an **Arrow Frame** / column projection.
- [ ] A pure `lib/` module computes ROC points, confusion-at-threshold, and accuracy/precision/recall/F1 from prediction rows; it tolerates malformed/edge input without throwing.
- [ ] Dragging the threshold slider recomputes the confusion matrix, ROC operating point, and the four metric readouts entirely client-side (no network call per drag).
- [ ] The slider's initial position is the model's real ~0.50 operating point; "Maximize F1" is shown as a labeled what-if; metrics are labeled "recomputed from hold-out".
- [ ] The view does not render for a run lacking the `*_proba`/`*_actual` schema.
- [ ] A replay-fixture UAT drives the whole frontend from a captured transcript carrying the predictions artifact and asserts the panel renders and the slider recomputes the matrix.

## Blocked by

- None — can start immediately.
