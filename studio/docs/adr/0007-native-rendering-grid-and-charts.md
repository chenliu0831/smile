# Native rendering for tabular data and charts (Perspective + ECharts)

## Context

The agent's analysis skills emit charts as structured **`DataViz` tool calls** (`bar`, `line`, `scatter`, `boxplot`, `heatmap`) — chart specs, not PNGs — and produce large tabular artifacts (DataFrame previews, `candidate_scores.md`, prediction result sets). To hit the Sigma/DataRobot UX bar these must render as live, interactive, themed components, not flat images or naive HTML tables.

## Decision

**Tabular data → Perspective (FINOS).** A C++/WASM streaming query engine with native Apache Arrow read/write/streaming (verified 3-0 in research). It is the **Data Grid** for every tabular surface: DataFrame previews, the Leaderboard, prediction result sets, and Sigma-style pivot/drill exploration. Data crosses the boundary as **Arrow Frames** (ADR-0002), fed straight into Perspective with no JSON conversion — this is why Perspective + Arrow is a single coherent choice, not two.

**Charts → render `DataViz` calls natively client-side, NOT as PNGs.** The daemon forwards the structured chart spec inline on the agent stream (small JSON); the backing data arrives as an Arrow Frame. Recommended library: **Apache ECharts** — covers the full skill chart set, handles large series (canvas/WebGL), themes cleanly. **This library choice is a recommendation pending a short spike, not a locked decision** — the research did not verify a charting-library comparison (Vega-Lite and Plotly are the considered alternatives). The *decision that is locked* is: render natively from the structured spec, never display agent-generated PNGs.

## Considered Options

- **Native render (chosen).** Interactive, themed, drill-capable; matches Sigma's "click any chart element to drill" affordance.
- **Display agent-produced PNG images.** Rejected: flat, non-interactive, theme-mismatched, not world-class.
- Grid alternatives (AG-Grid, glide-data-grid, TanStack): viable but lack Perspective's native Arrow streaming + pivot engine; only Perspective survived research verification.

## Consequences

- The agent skills should keep emitting structured `DataViz` calls (not save PNGs) for the canvas to render; if a skill emits an image, the canvas degrades to showing it but loses interactivity.
- Perspective (WASM) and ECharts are bundled into the Webview; both are client-side, keeping rendering off the daemon.
- Arrow is reaffirmed as the single columnar boundary format feeding both the grid and chart data.
