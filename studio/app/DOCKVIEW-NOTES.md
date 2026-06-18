# Dockview shell — integration notes (ADR-0008)

## Status: dockview works. App builds (vite) and all tests pass.

The dockview-based single-window shell is implemented and working:

- `npx vite build` succeeds — dockview, its CSS, and all panels bundle cleanly.
- `npm test` passes 21/21, including `App.test.tsx` (the mock run still streams:
  goal "churn" and stage "Exploratory Data Analysis" render inside the Run panel).

## Pre-existing `tsc` failure NOT caused by this work

`npm run build` runs `tsc --noEmit && vite build`. The `tsc` gate currently
fails, but **only** on `src/ui/DataGrid.tsx` (TS6133 "declared but never read"
for `perspective`, `perspectiveViewer`, `SERVER_WASM`, `CLIENT_WASM`).

`DataGrid.tsx` and `Leaderboard.tsx` (its only importer) are owned by a separate,
concurrent task and are explicitly off-limits to this task. They are incomplete
(unused Perspective imports) and unrelated to the dockview layout. None of the
files added/changed by the dockview work produce any type errors. Once the
DataGrid/Perspective task completes its file, `npm run build` goes green with no
change needed here.

## React 18 / Vite / Vitest gotchas encountered

- **ResizeObserver under jsdom.** dockview's grid uses `ResizeObserver`, which
  jsdom does not implement. Added a minimal no-op stub in `src/test/setup.ts`
  (the existing Vitest setupFile) so the shell can mount in tests. Without it,
  every test rendering `<App />` throws `ResizeObserver is not defined`.
- **One Run, two readers.** The topbar (chrome, outside the dock) and the Run
  panel (inside the dock) both need the same RunState. `useRun()` is per-call
  (own reducer + own MockRunPlayer), so calling it twice would spawn two runs.
  Solved with `RunContext` — a single `RunProvider` wraps the shell; both read
  the one controller.
- **dockview v6 API.** `DockviewReact` `onReady` gives `event.api` (a
  `DockviewApi`) with `addPanel`, `toJSON`/`fromJSON`, `clear`, `panels`, and
  `onDidLayoutChange` — all used here. CSS lives at
  `dockview/dist/styles/dockview.css`; theming is via `--dv-*` CSS variables
  scoped to a custom `.dockview-theme-smile` class.

## Layout persistence

`event.api.onDidLayoutChange` serializes `api.toJSON()` to `localStorage` under
`smile.studio.layout.v1` on every change. On `onReady` we `fromJSON(...)` the
saved layout if present; if absent/corrupt/empty we `clear()` and build the
default (Run home + Notebook tab + Kernel panel to the right), keeping the Run
panel active so the agent-centered HOME is the default visible content.
