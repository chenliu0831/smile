# S5 — Scorecard + task_type (skill sidecar → metrics artifact → metric strip)

> ready-for-agent · PRD: ../PRD-explorable-automl-cockpit.md · ADR-0011, ADR-0014

## What to build

A complete slice that turns the run's headline metrics into a persistent **Scorecard** and uses the `task_type` it carries to kill the hard-coded `"binary"` in the **Leaderboard**. This slice carries the skill-sidecar overlay (ADR-0014), because the data does not exist as a structured file today.

End-to-end:
1. **Skill overlay (ADR-0014):** extend the automl skill via the existing `ioa-overlay/` mechanism so it writes `output/final_metrics.json` (task_type, primary_metric, OOF/test scores, accuracy/F1, ensemble method) as a public JSON sidecar. Verified prerequisite: this file is *not* produced today — the metrics live only as prose in `automl_report.md` or the private `state.json` (which ADR-0006 forbids parsing). The daemon must never parse the report or read `state.json`.
2. **Contract:** add the `metrics` literal to `ArtifactKind`.
3. **Watcher:** on `final_metrics.json` appearance, emit a `metrics` **Artifact** with the parsed-as-bytes JSON inline in `meta` (no daemon-side parsing beyond inlining).
4. **UI:** render a persistent **Scorecard** strip in the shell chrome *above the canvas* (not an artifact-kind branch — it is persistent, read via a selector over the `metrics` artifact): problem type · primary metric · CV · rows, then headline scores that fill in as the run completes, with hover-to-source and the ensemble/stacking summary. Feed the `task_type` into the metric resolution so the **Leaderboard** column labels are correct for binary/multiclass/regression, replacing the hard-coded `"binary"`.

## Acceptance criteria

- [ ] The overlaid automl skill emits `output/final_metrics.json` as a public output (carrying at least task_type, primary_metric, OOF/test scores, ensemble method).
- [ ] `metrics` is added to `ArtifactKind` across contract, schema, and Java mirror; the watcher emits a `metrics` **Artifact** with JSON inline in `meta` and parses no report markdown / no `state.json`.
- [ ] A persistent **Scorecard** strip renders above the canvas from the `metrics` artifact via a selector; scores fill in as the run completes; hovering a metric reveals its source field/step.
- [ ] The **Leaderboard**'s metric is driven by the run's real `task_type` (no hard-coded `"binary"`); a non-binary run shows correct metric labels.
- [ ] The Scorecard hides gracefully when no `metrics` artifact is present.
- [ ] Conformance test covers the `metrics` representative; a replay-fixture UAT asserts the strip renders from a captured `metrics` artifact.

## Blocked by

- S1 — `meta` field prefactor
