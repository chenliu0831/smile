# @smile/contract

The **single source of truth** for the wire contract between the three Smile Studio
components. Authored once in [TypeBox](https://github.com/sinclairzx81/typebox); the
canonical JSON Schema is generated from it and validated by every component in CI. This is
Option B of the architecture review: front and back stay loosely coupled because neither
hand-mirrors the other — both answer to this module.

The **transport is unchanged** (JSON over WebSocket + REST, ADR-0002). This module
single-sources the *shapes* only. Bulk columnar data still travels out-of-band as Arrow
frames referenced by `ArrowRef`; only the JSON control/event frames and REST envelopes are
modelled here.

## What's in here

| File | Contents |
|------|----------|
| `src/daemonMessage.ts` | The `DaemonMessage` union (daemon → webview) + `WebviewReply` (webview → daemon). |
| `src/rest.ts` | The daemon REST request/response JSON shapes (`/sql`, `/tables`, `/dataset`, `/data`). |
| `src/tauri.ts` | The Shell ↔ Webview Tauri command payloads (`DaemonInfo`, `LlmConfig`, `LoadedDataset`, `StagedDataset`). |
| `src/validate.ts` | Runtime validation helpers (TypeBox `Value`); `assertValidInDev` is the dev-only frame check. |
| `schema/*.json` | **Generated** Draft-7 JSON Schema — committed build output the Java/Rust sides consume. |

## Who consumes it

- **Webview** (`studio/app`) — imports the TS types via `@smile/contract` (re-exported through
  `app/src/daemon/protocol.ts`, so existing imports are unchanged). `wsClient` runs
  `assertValidInDev` on every inbound frame (dev only; never throws in prod).
- **Daemon** (`serve`) — `ContractConformanceTest` serializes its `DaemonMessage`/REST records
  and validates them against `schema/*.json`.
- **Shell** (`src-tauri`) — `tests/contract_conformance.rs` serializes its command-payload
  structs and validates them against `schema/*.json`.

## Changing the contract

1. Edit the TypeBox definition in `src/`.
2. `npm run gen` — regenerate `schema/*.json`. **Commit the regenerated files.**
3. `npm test` — the golden-frame corpus (real captured daemon bytes) must still validate.
4. Update the mirrored Java records / Rust structs to match, then run their conformance
   tests:
   - `./gradlew :serve:test --tests "smile.daemon.ContractConformanceTest"`
   - `cargo test --test contract_conformance` (in `studio/app/src-tauri`)

`npm run gen:check` fails if the committed schema is stale — wire it into CI so a contract
change that skips step 2 can't merge.

## Why hand-written types, not codegen (yet)

The Java records and Rust structs are still hand-written, validated *against* this schema
rather than generated *from* it. That was a deliberate near-term choice: it kills silent
drift (the actual problem) with zero transport change and no codegen toolchain. If/when full
codegen is wanted, this schema is the artifact to generate from — and the golden-frame corpus
is the conformance suite that proves the generated types match real daemon bytes.
See the architecture review's ConnectRPC evaluation for the heavier alternatives considered.
