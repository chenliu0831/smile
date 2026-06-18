# Smile Studio — Reimagined Frontend: Implementation Plan

Derived from `CONTEXT.md` and ADRs 0001–0010. Goal of this pass: a runnable **V0** of the agentic-first AutoML experience.

## Strategy

Lead with the **frontend experience** (where the world-class UX lives, and what is verifiable autonomously), built against a **typed mock of the daemon protocol** so it runs in a browser today and drops onto the real JVM daemon (evolved `serve/`) later. TDD the new core logic.

- **Stack:** Vite + React + TypeScript; dockview (layout, ADR-0008); Perspective (data grid, ADR-0007); ECharts (charts, ADR-0007); Tauri shell (ADR-0001). Vitest for TDD.
- **Location:** `studio/app/` (new Tauri app), `studio/app/src-tauri/` (Rust shell).
- **Mock daemon:** `src/daemon/mock/` replays a realistic AutoML Run over the same typed message contract the real WS/REST daemon will speak (ADR-0002).

## Protocol (ADR-0002, 0006) — the seam the UI is built against

Typed messages the daemon streams; mock and real daemon both emit these:
- `RunProgress { stageId, label, status, artifactRefs[] }` — drives the pipeline timeline.
- `AgentChunk { runId, text }` — token stream.
- `ToolCall { id, title, kind, status, code?, output?, score? }` — collapsible cards.
- `Question { id, prompt, options? }` — Clarify gate (existing `onQuestion`).
- `Artifact { kind: report|leaderboard|chart|file, ref, ... }` — Run Artifacts.
- `ArrowFrame` (binary, out of band) — tabular data into the Data Grid.
- `DataVizSpec { type, encodings, dataRef }` — native chart render.

## Phases

### Phase 1 — Scaffold & core logic (TDD)  ← V0 foundation
1. Vite+React+TS app, Vitest. → verify: `npm test`, `npm run build` green.
2. TDD `runProgress` reducer (protocol events → timeline+artifact state). → verify: tests pass.
3. TDD `leaderboard` parser (`candidate_scores.md`/`refinement_log.md` → sortable rows, problem-type metric). → verify: tests pass.
4. TDD `gate` state machine (Auto/Clarify/Approval/Plan; approve-on-start default). → verify: tests pass.

### Phase 2 — AutoML Run view (ADR-0006, 0008)
5. dockview single-window shell; agent-centered home; Notebook + Kernel rails as peers.
6. Three-zone Run view: pipeline timeline / artifact canvas / agent stream.
7. Tool-call cards (collapsible), Question gates inline, progressive disclosure.

### Phase 3 — Rendering (ADR-0007)
8. Perspective Data Grid fed by mock Arrow frames (leaderboard, DataFrame preview).
9. ECharts native render of DataViz specs (ROC, confusion heatmap, SHAP bar).

### Phase 4 — Mock run & Tauri shell
10. Mock daemon replays a full churn-prediction AutoML Run end to end.
11. Tauri Rust shell wraps the webview; sidecar lifecycle stub. → verify: builds.

## Out of scope for V0 (deferred per ADRs)
- Real JVM daemon endpoints (ADR-0005 surfacing is mocked; daemon work is the next pass).
- Deployment / serve seam (ADR-0009, deferred).
- Scala kernel, Notepad (ADR-0008 deletions).
- ECharts vs Vega-Lite and dockview final choice are recommendations pending spike (ADR-0007/0008).
