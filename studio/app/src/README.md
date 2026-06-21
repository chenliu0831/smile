# Smile Studio Webview — source layout

The Webview is a React + TypeScript app. It is **UI only**: all backend capability lives in
the Smile Daemon (Java) and is reached over a token-authenticated loopback WebSocket + REST
(ADR-0002). The Rust Shell (`../src-tauri`) spawns the daemon and brokers OS access.

Modules are organized by **role**, so a newcomer can find things by what they do:

| Dir | Role | Key files |
|-----|------|-----------|
| `daemon/` | **How we talk to the backend.** The wire protocol, the connection (real WebSocket / mock / error), and the REST clients. No React. | `protocol.ts` (re-exports the shared `@smile/contract` types), `wsClient.ts`, `connect.ts`, `sql.ts`, `dataset.ts`, `datasetInfo.ts`, `llmConfig.ts`, `mock/` |
| `store/` | **All application state.** A per-session Zustand store split into slices, plus the pure reducer, derived selectors, and the React entry points. | `runStore.ts` (composes the slices), `sessionSlice.ts` / `connectionSlice.ts` / `dataSlice.ts`, `runState.ts` (pure reducer), `selectors.ts`, `useRun.ts`, `RunContext.tsx` |
| `lib/` | **Pure helpers** — no React, no daemon. Parsers and transforms, unit-tested in isolation. | `leaderboard.ts`, `dataFrame.ts` (Arrow↔Perspective), `agentSql.ts` |
| `ui/` | **Components only.** They read state via `useRunContext` / selectors and render. | `Workspace.tsx` (shell), `AgentStream.tsx`, `SqlConsole.tsx`, `Canvas.tsx`, `DataGrid.tsx`, `Chart.tsx`, `Topbar.tsx`, … |
| `test/` | The replay-fixture harness + user-acceptance tests that drive the whole tree against captured daemon frames (no live backend). | `harness.ts`, `uat-*.test.*` |

## State: how it flows

```
daemon frames ──► connectionSlice.subscribe ──► sessionSlice.applyMessage
                                                   └─ reduceRun (pure) ──► session state
ui ──► useRunContext() (RunController) ──► store slices' actions (sendMessage, addData, …)
ui ──► selectors (selectIsBusy, selectDatasetName, selectLeaderboard, …) for derived facts
```

The store is created **per `RunProvider`** (not a global singleton) so each mount and each
test is isolated. The connection factory is **injected** (`useRun(connect)` /
`<RunProvider connect>`), which is how the test harness replays captured frames with no
backend — see `test/harness.ts`.

## The wire contract

Message/REST shapes are single-sourced in `../../contract` (`@smile/contract`, TypeBox) and
re-exported through `daemon/protocol.ts`. Don't hand-edit the types here — change the
contract and run `npm run gen` there. See `studio/AGENTS.md`.
