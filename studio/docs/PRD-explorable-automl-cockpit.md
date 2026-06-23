# PRD: Explorable AutoML Cockpit

> Status: ready-for-agent · Local PRD (not published to the issue tracker) · 2026-06-23
> Decisions: ADR-0011 (compute boundary + `meta`), ADR-0012 (Arrow IPC everywhere), ADR-0013 (ECharts + PNG fallback), ADR-0014 (skill JSON sidecars). Glossary: studio/CONTEXT.md → "Cockpit views".

## Problem Statement

When an **AutoML Run** completes, the user is handed a flat report viewer. The **Leaderboard** is a read-only five-row table hard-coded to binary AUC. The richest predictive artifact — the per-row prediction set in `final/submission.csv` — reaches the canvas as a dead `📄 path` string. Permutation importance, which the skill computes *with uncertainty*, renders as a flat numbered list with no magnitudes. Headline scores die in prose inside `automl_report.md`. The user can read what Clair found but cannot interrogate or steer it: there is no way to ask "what happens to precision if I move the threshold?", "which passengers did the model get wrong?", "is this feature ranking stable?", or "is the ensemble actually beating its base learners?" — even though every byte needed to answer is already on disk.

The gap is one of **surfacing and interaction**, not model quality. The run produces a goldmine of structured data; the **Cockpit** is about making it explorable.

## Solution

Turn the **AutoML Run** view into an explorable **Cockpit** — the same fixed chrome + swappable canvas, enriched with interactive, drillable surfaces over the run's existing **Run Artifacts**:

- **Predictions Studio** — a compound view over the per-row prediction set with a live threshold slider driving a confusion matrix and ROC curve, all recomputed in the browser as the slider moves. Click a confusion cell to list those rows; click a misclassified row to expand its features.
- **Scorecard** — a persistent metric strip above the canvas (problem type · primary metric · CV · rows, then headline scores), self-configuring the rest of the UI from the run's `task_type`.
- **Interactive Leaderboard** — the existing **Leaderboard** repointed at the merged ranking, made sortable, with score bars, conditional ±std whiskers, and per-**Candidate** hyperparameter drill-down.
- **Driver Diagnostics** — permutation importance as a horizontal bar chart with ±1 std whiskers; each bar an EDA entry point.
- **Close the Loop** — "Ask Clair about this column" and one-click "Next Steps" turn passive readouts into steering turns over the existing agentic `user-message` channel.

The data crosses the wire once; interaction is client-side. Structured payloads ride a new typed `meta` field on the **Artifact**. All tabular data uses **Arrow Frames** end-to-end. All bespoke visuals render with ECharts.

## User Stories

### Predictions Studio
1. As a data scientist, I want to drag a single decision-threshold slider and watch the confusion matrix recompute live, so that I can see the precision/recall trade-off at any operating point without re-running the model.
2. As a data scientist, I want accuracy, precision, recall, and F1 to update as I move the threshold, so that I can judge the cost of moving the operating point.
3. As a data scientist, I want the slider to open at the model's real operating point (~0.50), so that the first thing I see is the model's actual behavior, not a hypothetical.
4. As a data scientist, I want a "Maximize F1" what-if clearly labeled as *not validated* (in-sample on the hold-out), so that I am not misled into treating a tuned threshold as a generalization guarantee.
5. As a data scientist, I want a ROC curve with my current operating point marked, so that I can place the threshold I picked on the curve.
6. As a data scientist, I want to click a confusion-matrix cell and get the list of rows in it, so that I can inspect exactly which cases fall where.
7. As a data scientist, I want to click a misclassified row and expand its feature values, so that I can form hypotheses about why the model erred.
8. As a data scientist, I want a probability-separation histogram by true class, so that I can see how cleanly the model separates the classes.
9. As a data scientist, I want the client-computed metrics labeled "recomputed from hold-out", so that a ±0.001 drift from the report reads as rounding, not a bug.
10. As a data scientist running a regression or unlabeled task, I want Predictions Studio to cleanly not appear, so that the UI never shows a broken classification view for a task it doesn't fit.

### Scorecard
11. As an analyst, I want a persistent strip showing problem type, primary metric, CV strategy, and row count, so that I always know the run's framing without hunting through the report.
12. As an analyst, I want the headline scores (OOF, test, accuracy, F1) to fill in as the run completes, so that I see results the moment they exist.
13. As an analyst, I want to hover a metric and see which field and which step produced it, so that I can trace a number to its source.
14. As an analyst, I want the ensemble composition and the stacking-vs-average comparison summarized, so that I understand how the final model was assembled.
15. As an analyst running a non-binary task, I want the metric labels to be correct for regression/multiclass, so that the UI is honest about what it's measuring.

### Interactive Leaderboard
16. As a data scientist, I want the **Leaderboard** to show every model the run produced (defaults, tuned, ensembles), not just the five default candidates, so that I see the full picture.
17. As a data scientist, I want to sort the board by any column, so that I can rank by the dimension I care about.
18. As a data scientist, I want horizontal score bars color-coded by model type (ensemble/tuned/default), so that I can scan relative performance at a glance.
19. As a data scientist, I want ±std whiskers shown only where std is finite, so that tuned/ensemble rows (which have no std) don't render misleading whiskers.
20. As a data scientist, I want to expand a row and see its tuned hyperparameters with a "copy as Python dict", so that I can reproduce or reuse the configuration.
21. As a data scientist, I want a default-vs-tuned delta on an expanded row, so that I can see what tuning bought.
22. As a data scientist, I want a verdict block showing the weighted-average ensemble beat every base learner and stacking, so that I trust the final selection.
23. As an analyst, I want the board's metric to match the run's real `task_type`, so that the column header isn't wrongly labeled "AUC" for a regression run.

### Driver Diagnostics
24. As an analyst, I want permutation importance as a sorted horizontal bar chart, so that I can see the relative magnitude of each driver, not just its rank.
25. As an analyst, I want a ±1 std whisker on each importance bar, so that I can tell a stable ranking from a noisy one at a glance.
26. As an analyst, I want to hover a bar and read the exact mean±std plus a plain-English line, so that I get a precise and an intuitive reading.
27. As an analyst, I want to click a feature and ask Clair about it, so that I can investigate a driver conversationally.
28. As an analyst, I want to click a feature and slice survival by it inline, so that I can confirm a driver's effect in the data.

### Close the Loop (steering)
29. As an analyst, I want an "Ask Clair about this column" affordance on each SQL Console schema-rail column, pre-seeded with the column's name, dtype, and driver rank, so that I can interrogate any column in one click.
30. As an analyst, I want Clair to answer in chat and propose a confirming SQL into the editor (insert-then-Run, not auto-run), so that I stay in control and we don't fight the agent for the single DuckDB connection.
31. As an analyst, I want the report's "Recommended Next Steps" rendered as one-click buttons that send a templated steering turn, so that I can act on Clair's recommendations without retyping them.
32. As an analyst, I want a regenerated report to refresh the canvas, so that re-running a step updates what I see.

### Cross-cutting
33. As a user, I want each cockpit surface to gracefully hide when its data is absent, so that an incomplete run never shows broken panels.
34. As a user, I want charts to render natively (interactive, themed) whenever the underlying data exists, and fall back to the agent's PNG only when no data is exposed, so that I get interactivity wherever it's possible.

## Implementation Decisions

### Contract: the `meta` field and two new kinds (ADR-0011)
- Add a single optional `meta` field (free-form JSON) to the **Artifact** record/type, carried in lockstep across the TypeBox contract (source of truth), the regenerated JSON Schema, and the hand-mirrored Java `record Artifact`. This is one positional edit to the Java record (~5 call sites) — bounded and guarded by the contract-conformance test.
- `body` reverts to its original meaning: Markdown or a `data:` URI only. It is no longer overloaded with JSON.
- Add exactly two `ArtifactKind` literals: `metrics` and `diagnostics`. Each is 1:1 with a distinct renderer.
- **Reuse** the existing `dataframe` kind for the prediction set (via the existing `data` → **Arrow Frame** reference) and the existing `leaderboard` kind for the board. No new kinds for these.

### Compute boundary: materialize once, compute client-side (ADR-0011)
- The daemon materializes the prediction set once: a DuckDB `CREATE OR REPLACE VIEW` over `final/submission.csv`, served via the existing `/data/{ref}` path. There is exactly one synchronized DuckDB connection shared with the agent; per-interaction round-trips are forbidden.
- A pure, React-free `lib/` module computes ROC, confusion-at-threshold, F1, accuracy, precision, and recall from the in-memory prediction rows. The threshold slider recomputes entirely client-side and never touches the network.
- Client-computed metrics are anchored against the daemon's own numbers (test AUC/F1 from the metrics artifact) and labeled "recomputed from hold-out".
- The ~5-row permutation-importance array rides **inline** in the `diagnostics` artifact's `meta` — no DuckDB call, no **Arrow Frame**.

### Tabular transport: Arrow IPC everywhere (ADR-0012)
- **Arrow Frames** are the single tabular wire format. The **Data Grid** consumes Arrow IPC directly into Perspective (dropping the schema+JSON detour). `/data/{ref}` emits Arrow IPC; chart consumers decode it client-side (`tableFromIPC`, already a dependency) into the in-memory arrays ECharts needs; the built-in demo fallback tables emit Arrow too.
- This *restores* ADR-0002/0007 (the schema+JSON grid path was an unrecorded deviation). The Int64 overflow that motivated the detour is solved by Arrow's explicit typing; the `null pointer passed to rust` crash was a viewer lifecycle race, already fixed independently of format.
- **This migration is a separate, non-blocking track** (its own issue). The Cockpit features do not depend on it — Predictions Studio reuses `/data/{ref}` regardless of the encoding it emits.

### Rendering: ECharts for all cockpit visuals, PNG fallback (ADR-0013)
- All bespoke Cockpit visuals render with ECharts (already the sole chart library; zero new dependency): ROC = line/scatter with a marked operating point, confusion = heatmap with cell-click handlers, threshold markers = markLine/markArea, importance whiskers = a `custom` series (error bars). The plain-SVG exception the research doc proposed is dropped.
- These are app-built compound React components mounted in canvas branches, *not* agent-emitted **DataViz calls**; the DataViz spec remains for Clair's single-chart calls. Implementing the error-bar `custom` series and the currently-stubbed boxplot case is a one-time cost.
- Per-element click handlers enable the "click a cell / click a bar" interactivity.
- When an agent output is a flat PNG with no underlying data exposed, the existing `image` (base64) path renders it and accepts the loss of interactivity.

### Data sourcing: skill emits JSON sidecars (ADR-0014)
- The headline metrics and tuned hyperparameters the **Scorecard** and the drill-down need do **not** exist as structured files today — verified against the automl `SKILL.md` in the ioa jar. `final_metrics.json` and `best_params.json` are not produced; the data lives only as prose/tables in `automl_report.md` or in the private `state.json` (which ADR-0006 forbids parsing for display).
- The fix is on the skill side: overlay the automl skill (via the existing `ioa-overlay/` mechanism) to emit `output/final_metrics.json` (task_type, primary_metric, OOF/test scores, ensemble method) and the tuned hyperparameters as public JSON sidecars.
- The `RunArtifactWatcher` surfaces these like any public file — inline the raw bytes into `meta`, let the consumer parse. **The daemon parses no report Markdown and reads no `state.json`.**
- `postprocess_results.json` (Driver Diagnostics) and `final/submission.csv` (Predictions Studio) already exist as real public outputs; only the metrics/params sources need the overlay.

### Watcher emit branches
- Add watch targets for the new public files (`final_metrics.json` → `metrics` kind; `postprocess_results.json` → `diagnostics` kind; the predictions view of `final/submission.csv` → `dataframe` kind with an **Arrow Frame** reference). Each needs an emit trigger and a dedupe key, following the existing `STAGES`/freeform pattern.
- Give the report artifact the same mtime-keyed re-emit the image path already has, so a regenerated report refreshes the canvas (story 32).

### Frontend view placement
- **Predictions Studio** and **Driver Diagnostics** are new artifact-kind branches in the canvas's per-artifact dispatch (they *are* artifacts: `dataframe` and `diagnostics`).
- The **Scorecard** is a persistent strip in the shell chrome (above the canvas), reading the `metrics` artifact via a selector — *not* an artifact-kind branch, because it is persistent and not one-artifact-at-a-time.
- The **Leaderboard** stays on its existing kind and is enhanced in place; its hard-coded `"binary"` is replaced by the `task_type` the metrics artifact now carries.
- State stays in the single Zustand store; the new artifacts upsert into the one artifacts Record by ref. No new store shapes.

### Steering
- "Ask Clair about this column" and "Next Steps" reuse the existing `sendMessage` / `askClair` / `awaitingAgentSql` seams and the `user-message` channel. No new transport. Insert-then-Run is preserved (don't contend for the single DuckDB connection).

## Testing Decisions

A good test asserts **external behavior**, not implementation: given real (or realistically captured) inputs, the observable output is correct. The codebase already isolates pure logic into `lib/` modules and exercises the whole frontend against captured daemon payloads — both patterns are reused rather than reinvented. No new test harness is introduced; all five seams extend existing ones.

1. **Pure `lib/` compute modules.** The new client-side metric math (ROC, confusion-at-threshold, F1/accuracy/precision/recall) and the metrics/diagnostics payload parsing live in pure, React-free modules taking data and returning derived values. Tested directly with hand-built inputs, including malformed/edge inputs (crash-safety). Prior art: `lib/leaderboard.test.ts` (parse + rank + tolerate malformed agent output), `lib/agentSql.test.ts`.

2. **Reducer (`reduceRun`).** The new `metrics` and `diagnostics` artifacts upsert into the single artifacts Record by ref, and `meta` survives the message round-trip. Prior art: `store/runState.test.ts` ("artifact adds/replaces by ref at the session level").

3. **Replay-fixture UAT (the highest seam).** A captured transcript carrying the new artifacts drives the whole frontend — real reducer, real connection interface, real SQL/dataset/`/data/{ref}` clients — with no Java backend and no socket: Predictions Studio / Scorecard / Driver Diagnostics render, the threshold slider recomputes the confusion matrix, and "Ask Clair" emits a `user-message`. The harness already serves `/data/{ref}` and Arrow bytes, so the full materialize-once data path is exercised end to end. Prior art: `test/uat-*.test.tsx`, `test/harness.ts`.

4. **Java contract-conformance.** The new `meta` field and the `metrics`/`diagnostics` kinds serialize from the Java records and validate against the regenerated JSON Schema, catching Java↔TS mirror drift. Prior art: `ContractConformanceTest.java`.

5. **Java watcher.** The watcher emits the new artifacts on file appearance (including the `final_metrics.json` sidecar), inlining bytes into `meta` with no JSON parsing, and re-emits the report on mtime change. Prior art: `RunArtifactWatcherTest.java`.

## Out of Scope

- **The Arrow-IPC tabular consolidation (ADR-0012)** — committed, but tracked as a separate, non-blocking migration; not gated by or gating this PRD.
- **Deferred items needing skill-side structured sidecars beyond `final_metrics.json`:** live pipeline cockpit / mid-flight steering, the refinement curve, skipped-step cards, the feature-engineering provenance graph, the pipeline DAG/branch view, the missingness/imputation map. These need per-cycle jsonl or lineage sidecars the skill does not emit; do not reverse-engineer the private checkpoint.
- **Calibration as a hero panel** — on the verified run, calibration is a near-no-op (raw == calibrated to 7 digits); not worth a flagship surface.
- **"Remove feature & re-run"** — deferred until agent-side feature exclusion is confirmed.
- **"Ask about this histogram bar" on flat-PNG charts** — PNGs carry no per-bar click targets; this is a later dependency on native rendering, not this work.
- **Deploying the winning model** — the **Solution Pipeline** is advisory; only a JVM **Trained Model** is deployable, and deployment is deferred (ADR-0009).

## Further Notes

- **Honesty framing is load-bearing.** Threshold tuning on the hold-out is in-sample: the "Maximize F1" affordance must read as a what-if, not a validated result, and the slider opens at the model's real operating point. Client-computed metrics are labeled "recomputed from hold-out" so small drifts read as rounding.
- **Pin every number to one source.** The run's files disagree on per-model AUC (tuning-CV vs OOF vs default); the Leaderboard must pin each displayed number to a single source and compute lift client-side so the arithmetic always reconciles. Key the hyperparameter companion by the agent's own model names to avoid the `xgb` ≠ `xgboost` join bug, and badge models that exist only in a tuned form.
- **Graceful absence everywhere.** Every surface gates on the presence (and, for Predictions Studio, the schema) of its data, so partial or non-classification runs degrade cleanly rather than break.
- **Build sequence:** (1) contract enabler (`meta` + two kinds) and the skill sidecar overlay are the Wave-1 prerequisites; (2) zero-backend quick wins (Leaderboard repoint + sort + bars; Ask-Clair-about-column; Next-Steps) ride on already-surfaced data and the existing message channel; (3) the flagship consumers (Predictions Studio, Driver Diagnostics whiskers) land on the surfaced data.
- This PRD is kept **local** at the user's request (not published to `chenliu0831/smile` Issues).
