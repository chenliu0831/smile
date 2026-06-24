# S4 — Driver Diagnostics (permutation importance with ±std whiskers)

> ready-for-agent · PRD: ../PRD-explorable-automl-cockpit.md · ADR-0011, ADR-0013

## What to build

The first consumer of the `meta` field (S1). A complete slice surfacing permutation importance — *with its uncertainty* — as an interactive chart and an EDA entry point.

End-to-end: add the `diagnostics` literal to `ArtifactKind`. The `RunArtifactWatcher` reads the existing public `postprocess_results.json` (a real skill output — top-5 feature importance with mean AND std) and emits a `diagnostics` **Artifact** carrying the small importance array **inline in `meta`** — no DuckDB view, no **Arrow Frame** (the array is tiny). The daemon does not parse beyond inlining the bytes; the consumer parses `meta`. A new canvas branch renders a sorted horizontal bar chart with a ±1 std whisker on each bar, using ECharts (bars + an error-bar `custom` series — this is the one-time custom-series build noted in ADR-0013, not plain SVG). Hovering a bar shows exact mean±std plus a plain-English line. Clicking a feature offers "Ask Clair about &lt;feature&gt;" (templated `sendMessage`) and "Slice survival by it" (a grouped SELECT inline) — both reuse the existing steering/SQL seams.

Whiskers render only where std is finite.

## Acceptance criteria

- [x] `diagnostics` is added to `ArtifactKind` across the TypeBox contract, regenerated JSON Schema, and Java mirror.
- [x] The watcher emits a `diagnostics` **Artifact** from `postprocess_results.json` with the importance array inline in `meta`; it performs no parsing beyond byte-inlining.
- [x] The canvas renders a sorted horizontal importance bar chart with ±1 std whiskers (ECharts custom series), whiskers shown only where std is finite.
- [x] Hover reveals exact mean±std and a plain-English line; clicking a feature fires an "Ask Clair" turn over the `user-message` channel and offers an inline "slice by" SELECT.
- [x] The contract-conformance test covers the `diagnostics` representative; a replay-fixture UAT asserts the chart renders from a captured `diagnostics` artifact.

## Blocked by

- S1 — `meta` field prefactor

**Status: complete.** `diagnostics` ArtifactKind added; watcher inlines postprocess_results.json into `meta` via a generic JSON-sidecar scan (also wired for S5's final_metrics.json); PermImportanceChart renders ECharts bars + ±std whiskers (custom series) with click→Ask Clair/Slice steering. Verified: app 119 tests + tsc clean; serve watcher/conformance pass.
