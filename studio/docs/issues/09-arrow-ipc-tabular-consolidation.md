# S9 — Arrow IPC tabular consolidation (separate track)

> ready-for-agent · PRD: ../PRD-explorable-automl-cockpit.md · ADR-0012 · **Separate, non-blocking track**

## What to build

Make **Arrow Frames** the single tabular wire format end-to-end, restoring ADR-0002/0007. This is independent of the Cockpit features (they reuse `/data/{ref}` regardless of its encoding) and touches the SQL-grid hot path, so it is tracked as its own slice.

End-to-end: the **Data Grid** consumes Arrow IPC directly into Perspective, dropping the schema+JSON-rows detour. `/data/{ref}` emits Arrow IPC; chart consumers decode it client-side (`tableFromIPC`, already a dependency) into the in-memory arrays ECharts needs; the built-in demo fallback tables emit Arrow too.

Context that de-risks this (verified): the `null pointer passed to rust` crash that motivated the schema+JSON detour was a **Perspective viewer lifecycle race**, already fixed independently of ingestion format; and the Int64 overflow the detour also cited is a *JSON* problem (untyped numbers → inferred i32) that Arrow's explicit typing *solves*. If a Perspective-on-Arrow bug surfaces in practice, diagnose it on its merits.

## Acceptance criteria

- [ ] The **Data Grid** ingests Arrow IPC directly into Perspective (no schema+JSON detour) and renders the captured Int64/Float64/Utf8 fixture columns without the `null pointer passed to rust` crash and without Int64 id overflow.
- [ ] `/data/{ref}` emits **Arrow Frames**; chart consumers decode them client-side into ECharts arrays.
- [ ] The demo fallback tables emit Arrow.
- [ ] Existing SQL-console and grid behavior (including the up-to-50k-row path) is preserved.
- [ ] The existing replay-fixture and DataGrid tests pass against the Arrow-only path; the rapid-churn stress scenario remains crash-free.

## Blocked by

- None — can start immediately, independently of the Cockpit feature slices.
