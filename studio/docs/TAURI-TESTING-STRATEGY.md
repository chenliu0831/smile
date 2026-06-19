# Tauri App Testing Strategy — Research Finding

**Status:** Researched & recommended; **implementation deferred** (2026-06-19).
**Method:** multi-agent deep research (external Tauri-2 e2e tooling + internal gap analysis +
past-bug coverage + feasibility), 3 adversarially-judged design proposals, synthesized; the
load-bearing tooling/code claims were then hand-verified against this repo (see "Verified
claims" below).

This documents *how to test and verify the Smile Studio Tauri desktop app* and closes a
known gap: there is currently **no end-to-end coverage** of the desktop app, and CI does not
build or test it at all. It is a finding for a future work item, not a committed change.

---

## The gap (baseline as of this writing)

- **Frontend:** ~50 vitest tests (jsdom) — pure logic + React components. The Perspective
  data grid is WASM-backed and **cannot paint under jsdom**, so the render path is unverified.
- **Rust (Tauri Shell):** 6 `#[test]` in `lib.rs` covering **only** `build_daemon_invocation`
  (pure arg/env data). **None** of the 6 live `#[tauri::command]` functions
  (`daemon_info`, `get_llm_config`, `set_llm_config`, `start_daemon`, `stop_daemon`,
  `load_dataset`), no process spawn, no daemon lifecycle.
- **Daemon (`serve/`):** 7 Quarkus `@QuarkusTest` files — reasonably covered in isolation,
  but the integration-tagged tests are **excluded in CI** (`-DexcludeTags=integration`).
- **No e2e:** nothing exercises the real Tauri IPC boundary (WebView `invoke` → Rust),
  the WebView↔Rust↔spawned-daemon↔LLM stack, daemon lifecycle, or the grid actually rendering.
- **CI** (`.github/workflows/ci.yml`) does **not** build or test the `studio/app` Tauri app.

**Tell:** every notable recent bug was caught by *manual* live testing, never by an automated
test. A good strategy must catch these classes (see the past-bug map below).

## The hard constraint that shapes the whole strategy

**macOS / WKWebView has no supported WebDriver** (Tauri issue #7068; Playwright can only
attach to Chromium-based WebView2, not WKWebView). A robot cannot drive the real macOS
window. So: build load-bearing coverage from **cheap deterministic layers** that run
identically on a Mac dev box and in CI, and keep the real-macOS-window check as a documented
**human runbook** (release gate), not a CI job.

**Determinism lever:** the daemon's own `smile.daemon.engine=scripted` backend (the
`RunService` default — needs **no LLM and no token**, replays a full run over the real WS
protocol). Tests swap the *backend* the WebView reaches, never the model. No Bedrock,
no expiring credential, in any blocking lane.

---

## Recommended strategy — "determinism-by-engine-seam" test pyramid

| Layer | Tool | What it covers | Effort |
|---|---|---|---|
| **L1** (extend) | vitest + RTL (jsdom) | Existing ~50 tests; add a `runState` test fed a recorded tool-call frame. | S |
| **L2** *(first PR)* | `@tauri-apps/api` **mockIPC** (already installed) | The WebView↔IPC boundary: drive `connectRun()`'s real Tauri branch; assert `mode = daemon\|error` and the **never-show-demo-inside-Tauri** invariant + `invoke` arg shapes. | S |
| **L3** | cargo `tauri = { features=["test"] }` MockRuntime | The 5 untested IPC commands + a separate `#[ignore]` serial **lifecycle** test driving real spawn/restart/kill against a stub `java` on PATH. | M |
| **L0** *(linchpin)* | packaged fast-jar smoke (`:serve:quarkusBuild` → boot `quarkus-run.jar` `engine=scripted`) | Boots the **packaged** jar and hits `/api/v1/sql` + `/tables` (real classloader boundary) + CORS (build-time prop) + WS token auth. The only layer that catches packaging-only bugs. | M |
| **L0.5** (enable) | Quarkus `@QuarkusTest` vs a fake LLM | Flip on the CI-excluded integration tests; `AgentRunSource` `onToolCallStatus` against a fake LLM. | M |
| **L4** | `@playwright/test` (headless Chromium) vs the **built** vite frontend + scripted jar fixture, opened with `?ws=` | The **only** layer where Perspective WASM actually paints: tool-call cards render, `<perspective-viewer>` paints `/sql` rows, SqlConsole auto-refresh after a mutation. | L |
| **L4.6** | bats + shellcheck on `run.sh` | The launcher reaches "Launching…" with/without the token and never sources `~/.zshrc`. | S |
| **L5** (optional, Linux-only, allow-failure) | tauri-driver + WebdriverIO on webkit2gtk/xvfb | One window-boots + `daemon_info`-invoke tripwire. **Not** proof of macOS behavior. | L |
| **L6** (release gate, not CI) | Manual macOS runbook | The un-automatable full stack: real WKWebView↔Rust↔JVM↔Bedrock with a runtime token. | S |

### How each past bug gets caught
| Past bug | Caught by |
|---|---|
| #1 `Agent.stream` dropped `onToolCallStatus` | **L0.5** serve test on `AgentRunSource` vs fake LLM (scripted engine bypasses the broken translation, so only this catches it) |
| #2 Quarkus CORS key renamed (build-time) | **L0** packaged-jar CORS assertion |
| #3 `SharedSql` classloader split (packaged-jar only) | **L0** packaged-jar `/sql` + `/tables` (no `ClassCastException`) |
| #4 Silent churn-mock fallback over real data | **L2** never-demo-inside-Tauri invariant |
| #5 `run.sh` sourced `~/.zshrc` → exited before launch | **L4.6** launcher smoke |
| #6 macOS keychain re-prompt | **L3** no-keychain-crate guard (keychain already removed) |
| #7 Datagrid stale after a mutation | **L4** render half; **L0.5** data half; agent-mutation→repaint half = **L6** manual (residual gap) |

### CI shape
Repo-root `.github/workflows/ci.yml`. New jobs: **frontend** (ubuntu + macos matrix: `npm ci`,
`tsc --noEmit`, `npm test` = L1+L2), **cargo** (ubuntu + macos = L3), **integrated** (ubuntu:
`:serve:quarkusBuild` → artifact → L0 smoke + L4 Playwright + `run.sh` bats). The integrated
jobs must reuse the existing LibTorch/ONNX/OpenBLAS provisioning (`serve` depends on `:deep`,
so the jar is **not** pure JVM). **No Bedrock token in any blocking lane;** the live-LLM smoke
is a separate non-blocking nightly gated on a short-lived secret.

### First PR (highest ROI)
`studio/app/src/daemon/connect.test.ts` (L2): with mockIPC (zero new deps) + a
`getRandomValues` polyfill in `src/test/setup.ts`, drive `connectRun()` through its real Tauri
branch and assert the **never-`demo`-inside-Tauri** invariant (`start_daemon` rejected →
`mode='error'`; success → `'daemon'` with ws URL + token; `?ws=` → `'daemon'`). This directly
guards the most dangerous user-facing bug (#4, silent churn demo over real data), runs in <5s
on Mac and CI with no daemon/JVM/token, and proves the mockIPC layer works before investing in
the heavier Rust/Playwright layers. Pair it with the Phase-0 CI wiring so it is enforced.

### Suggested phasing
0. Wire the **existing** ~56 tests into CI (they run on no PR today).
1. **L2** (the first PR).
2. **L3** + a small `SMILE_DAEMON_ENGINE` env seam in `build_daemon_invocation` (see below).
3. **L0** packaged-jar smoke + `run.sh` bats + flip on **L0.5** serve integration tests.
4. **L4** Playwright + extend `ScriptedRunSource` to emit `session-started` + await the first
   user-message (so L4 exercises the real interactive handshake).
5. Optional **L5** tripwire + the **L6** macOS runbook + nightly live-LLM smoke.

---

## Verified claims (hand-checked against this repo, post-synthesis)
- `start_daemon` **hardcodes** `-Dsmile.daemon.engine=agent` (`studio/app/src-tauri/src/lib.rs:99`),
  so the production arg vector never boots scripted → the `SMILE_DAEMON_ENGINE` seam is genuinely
  needed for L3 to test the real arg path token-free.
- The `scripted` engine is the **default** and token-free (`serve/.../RunService.java:41`, "demo/offline/tests").
- `@tauri-apps/api/mocks` (mockIPC) is **already in `node_modules`** → the first PR needs no new deps.
- The `?ws=` override runs **before** `inTauri()` in `connect.ts:56` → Playwright L4 needs no frontend change.
- Serve integration tests are **excluded in CI** today (`ci.yml:77`, `-DexcludeTags=integration`).

## Open questions (resolve during implementation)
- Does `tauri = { features=["test"] }` (unstable; field set drifts between 2.x minors) link
  against our `staticlib/cdylib/rlib` crate and resolve the store + dialog plugins under
  `MockRuntime`? Smoke-build before committing Phase 2; fall back to extracted plain-data
  helpers if not.
- Will the packaged scripted `quarkus-run.jar` boot cleanly on a fresh CI runner given the
  ~2GB LibTorch dependency? L0/L4 inherit that native toolchain; budget the extra CI minutes
  (the integrated jobs are roughly 5–6× the current CI surface).
- Are the two product-source touch-ups acceptable (both default-preserving): the
  `SMILE_DAEMON_ENGINE` seam, and extending `ScriptedRunSource` to emit `session-started` +
  await `takeUserMessage`? Or should L4 use a frozen recorded WS transcript fixture instead?
- The **agent-mutation → grid-repaint** half of bug #7 is only covered by the manual L6 run
  (the scripted engine runs no real tool SQL). Acceptable residual gap, or build a
  fake-LLM-issues-a-mutating-tool-call path?
- Fixture-rot story: how do frozen transcripts / the scripted-jar baseline stay in sync with
  `protocol.ts` and `AgentRunSource` as they evolve?
