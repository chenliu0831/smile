# Arrow IPC is the single tabular wire format (grid and charts)

## Context

Two wire encodings carry tabular data today: **Arrow IPC** (`/sql` → `sql.ts` → Perspective grid) and **column-JSON** (`/data/{ref}` → ECharts charts). The grid path additionally re-routes *around* Arrow — `DataGrid.tsx` ingests an explicit schema + JSON rows rather than re-fed Arrow IPC. That workaround cited two reasons: the `null pointer passed to rust` crash, and Perspective's type inference picking i32 and overflowing large DuckDB Int64 ids.

Both reasons have since been overtaken. The crash was diagnosed (see [[smile-perspective-crash-rootcause]]) as a **Perspective viewer lifecycle race** — an unawaited `delete()` racing the next `load()` under StrictMode + the summarize tick-storm — and fixed with a serialized op-chain + generation gate. That fix is **ingestion-format-independent**. And the Int64 overflow is a *JSON* problem (untyped numbers force inference); Arrow IPC carries explicit int64 in its schema, so it **solves** the overflow rather than causing it.

## Decision

**Arrow IPC is the single tabular wire format end-to-end.** The grid consumes Arrow IPC directly into Perspective (no schema+JSON detour). `/data/{ref}` also emits Arrow IPC; charts decode it client-side with `apache-arrow.tableFromIPC` (already a dependency, already used in `sql.ts`) into the in-memory JS arrays ECharts needs, and the built-in DEMO fallback tables emit Arrow too.

This **restores ADR-0002 and ADR-0007**, both of which already lock Arrow as the single columnar boundary "fed straight into Perspective with no JSON conversion." The schema+JSON grid path was an unrecorded *deviation* from those ADRs, not a decision they endorsed — so this is a restoration, not a superseding reversal.

## Considered Options

- **Consolidate onto column-JSON.** Rejected: would reverse the locked ADR-0002 Arrow-bulk clause and tax the up-to-50k-row SQL grid (boxed, untyped, heavier on the wire and to parse), to dodge a crash that is already fixed independently of format.
- **Keep two formats, scoped by role** (Arrow for bulk grid, column-JSON for small chart projections). Reasonable — chart projections are tiny, so a typed binary format buys little there — but rejected in favor of one format for a single coherent tabular story.

## Consequences

- ECharts gains a thin `tableFromIPC` → arrays decode step for chart data; negligible for small projections.
- If a Perspective-on-Arrow bug surfaces in practice, we diagnose it on its merits — the lifecycle fix and Arrow's explicit typing remove the two reasons the original detour existed.
