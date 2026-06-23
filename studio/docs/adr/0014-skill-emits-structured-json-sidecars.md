# The automl skill emits structured JSON sidecars; the daemon never parses report markdown

## Context

The Scorecard ([[0011]] `metrics` kind) and the leaderboard hyperparameter drill-down need *structured* metrics and tuned params. The UX research doc assumed these came from `output/final_metrics.json` and `output/best_params.json` as "intentional public outputs" — but verifying the automl `SKILL.md` (extracted from `ioa-agent-1.0.0.jar`) shows **neither file exists**. The headline metrics live only as prose + tables inside `automl_report.md` (`## Problem Setup`, `## Final Performance`) and tuned params inside `## Final Solution` + the `solution_vN_tuned.py` scripts. The only *structured* copy is `output/checkpoints/state.json` — the skill's private checkpoint, which ADR-0006 forbids the Webview/daemon from parsing for display.

`postprocess_results.json` (Driver Diagnostics, top-5 importance) and `final/submission.csv` (Predictions Studio) **do** exist and are real public outputs. Only the Scorecard/params sources are missing.

## Decision

**Close the gap on the skill side, not the daemon side.** Extend the automl skill — via the existing `ioa-overlay/` mechanism (already used to overlay `summarize/`) — to write `output/final_metrics.json` (task_type, primary_metric, oof/test scores, ensemble method) and, for the drill-down, the tuned hyperparameters as a structured public output. The `RunArtifactWatcher` then surfaces these the way it surfaces every file: inline the raw bytes, let the consumer parse. **The daemon parses no report markdown** and reaches into no `state.json`.

This keeps the watcher a no-parse byte-inliner, keeps the public-output / private-`state.json` boundary (ADR-0005/0006) intact, and gives the cockpit a clean typed contract instead of regexing prose.

## Considered Options

- **Parse `automl_report.md` daemon-side** into the metrics payload. Rejected: the watcher does zero parsing today; this couples the daemon to the report's exact section/prose format (fragile) and grows it a markdown parser.
- **Read `state.json`.** Rejected outright: reverses ADR-0006 and couples the wire contract to the skill's private, drift-prone checkpoint schema.
- **Defer the Scorecard's structured metrics and the param drill-down** until a clean source exists. Viable fallback if the overlay proves unreliable, but the overlay is cheap and unblocks the #2 flagship.

## Consequences

- **Wave 1 gains a skill-overlay task** (write the sidecar) as a prerequisite for the Scorecard — it is no longer a pure-frontend/daemon change.
- The agent must *reliably* emit the sidecar; treat its absence as a graceful no-op (Scorecard hides), the same gating the prediction-schema views already use.
- Establishes the pattern: when the cockpit needs structured data the skill only emits as prose, the fix is a skill-emitted public JSON sidecar, never daemon-side prose parsing.
