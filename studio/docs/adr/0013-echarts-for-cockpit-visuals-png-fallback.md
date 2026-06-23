# ECharts for all cockpit visuals, with a PNG fallback when no raw data is exposed

## Context

ADR-0007 locked "render natively from the structured spec, never PNG" but left the chart **library** as "a recommendation pending a short spike, not a locked decision" (ECharts recommended; Vega-Lite / Plotly considered). The new cockpit needs bespoke interactive visuals — ROC curve, confusion matrix, threshold markers, permutation-importance bars with ±std whiskers — and the research doc proposed rendering whiskers in "plain SVG, no ECharts," objecting that `DataVizSpec` has no whisker channel and is by-reference.

ECharts is already the sole chart library (`echarts ^6.1.0`, the only chart import in `app/src`). The doc's objections dissolve under [[0011]]: diagnostics ride an **inline** `meta` array (not by-reference `DataVizSpec`), so the by-reference objection is moot, and ECharts does error bars via a `custom` series. The doc's own interactivity asks — click a confusion cell → list rows, click an importance bar → "Ask Clair" — need per-element click handlers, which ECharts provides (`onEvents`) and hand-rolled SVG would force us to wire by hand.

## Decision

**Render all bespoke cockpit visuals with ECharts** (zero new dependency): ROC = line/scatter, confusion = heatmap with cell-click `onEvents`, threshold = `markLine`/`markArea`, importance whiskers = `custom` series. These are app-built compound React components in Canvas branches, *not* agent-emitted `DataViz` specs — `DataVizSpec` remains for Clair's single-chart calls. This resolves the ADR-0007 spike in favor of ECharts and **kills the plain-SVG exception**, keeping the rendering technologies to two (ECharts + the Perspective/d3fc grid).

**PNG fallback when no raw data exists.** Some agent outputs (e.g. a SHAP plot the skill renders internally) arrive as a flat PNG with no underlying data exposed. Native ECharts is preferred *whenever the raw data is available*; where it is not, the existing `kind:"image"` base64 path renders the PNG and accepts the loss of interactivity. This is a data-availability gate consistent with ADR-0007's locked clause applied pragmatically.

## Considered Options

- **ECharts default, plain SVG for whiskers only** (the doc's route). Rejected: introduces a third rendering technology for one widget and hand-wires its own click targets, for no capability ECharts lacks.

## Consequences

- One-time build cost: an ECharts error-bar `custom` series and the currently-stubbed `boxplot` case in `Chart.tsx`.
- ADR-0007's open library question is now closed; ADR-0007 is refined, not reversed (its locked "never PNG-by-preference" clause stands — PNG is a no-data fallback, not a default).
