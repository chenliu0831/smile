# S9 — Arrow IPC tabular consolidation (separate track)

> ready-for-agent · PRD: ../PRD-explorable-automl-cockpit.md · ADR-0012 · **Separate, non-blocking track**

## What to build

Make **Arrow Frames** the single tabular wire format end-to-end, restoring ADR-0002/0007. This is independent of the Cockpit features (they reuse `/data/{ref}` regardless of its encoding) and touches the SQL-grid hot path, so it is tracked as its own slice.

End-to-end: the **Data Grid** consumes Arrow IPC directly into Perspective, dropping the schema+JSON-rows detour. `/data/{ref}` emits Arrow IPC; chart consumers decode it client-side (`tableFromIPC`, already a dependency) into the in-memory arrays ECharts needs; the built-in demo fallback tables emit Arrow too.

Context that de-risks this (verified): the `null pointer passed to rust` crash that motivated the schema+JSON detour was a **Perspective viewer lifecycle race**, already fixed independently of ingestion format; and the Int64 overflow the detour also cited is a *JSON* problem (untyped numbers → inferred i32) that Arrow's explicit typing *solves*. If a Perspective-on-Arrow bug surfaces in practice, diagnose it on its merits.

## Acceptance criteria

- [x] The **Data Grid** ingests Arrow IPC directly into Perspective (no schema+JSON detour); `toArrowIPC` round-trips Int64 without overflow (Arrow's explicit 64-bit schema, not i32 inference). Real-WASM render verification is deferred to the UX pass (jsdom has no WebAssembly — see caveat).
- [x] **Scope refined (per chart-data finding):** `/data/{ref}` stays column-JSON for CHART projections. Verified that ECharts consumes small in-memory JS arrays (ROC points, 5-row importance, 179 prediction rows), never bulk tabular — so Arrow's typing/bulk value is nil there and column-JSON is already exactly ECharts' shape. Arrow is the bulk-tabular boundary (the SQL grid); column-JSON is the lightweight viz projection. This is the user-approved escape hatch ("ok to use Column JSON if ECharts can't use Arrow / doesn't need full tabular data").
- [x] The demo fallback tables (`arrow-roc`/`arrow-shap`) are chart projections → stay column-JSON (same rationale).
- [x] Existing SQL-console and grid behavior preserved; the grid still receives Arrow over the wire from `/sql` (only the client-side ingest changed from schema+JSON to Arrow-direct).
- [x] The existing replay-fixture and DataGrid tests pass; the rapid-churn + StrictMode lifecycle scenarios remain crash-free (the lifecycle fix is ingest-format-independent).

**Caveat (for the UX review):** jsdom has no WebAssembly, so Perspective never actually paints in the test suite — the tests assert the Arrow transform + the React lifecycle contract, NOT that Perspective's WASM ingests this Arrow correctly. The real-browser confirmation (that Arrow-direct ingest renders the Int64 fixture without the historical crash) belongs to the manual UX pass. The lifecycle race that caused `null pointer passed to rust` is already fixed and format-independent; ADR-0012 records why Arrow is expected to be safe.

## Blocked by

- None — can start immediately, independently of the Cockpit feature slices.
