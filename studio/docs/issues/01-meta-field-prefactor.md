# S1 — `meta` field prefactor (Artifact contract)

> ready-for-agent · PRD: ../PRD-explorable-automl-cockpit.md · ADR-0011

## What to build

A thin walking-skeleton change that adds a single optional `meta` field (free-form JSON) to the **Artifact** contract, threaded through every layer it crosses, with no consumer yet. This is the one shared structural change the Cockpit needs (both the Scorecard and Driver Diagnostics ride it), so it lands first as a prefactor — "make the change easy, then make the easy change."

End-to-end path: add `meta` to the TypeBox **Artifact** schema (the single source of truth) → regenerate the JSON Schema → add the corresponding component to the hand-mirrored Java `record Artifact` (one positional edit, fix the ~5 construction call sites) → ensure the reducer carries `meta` through the artifact upsert untouched → prove the round-trip in the contract-conformance test.

`body` is unchanged in shape but its *meaning* narrows to Markdown / `data:` URI only — no consumer should put JSON in `body` anymore. No new `ArtifactKind` literals in this slice; those arrive with their consumers (S4, S5).

## Acceptance criteria

- [x] The **Artifact** type carries an optional `meta` JSON field across the TypeBox contract, the regenerated JSON Schema, and the Java `record Artifact`. (`Opt(T.Any())` in TypeBox; `JsonNode meta` appended last to the Java record; schema regenerated + `gen:check` green.)
- [x] All existing `new Artifact(...)` call sites compile against the new positional record with no behavior change. (8 sites updated — 3 in RunArtifactWatcher, 5 in ScriptedRunSource; `:serve:compileJava` succeeds.)
- [x] The reducer preserves `meta` verbatim when an artifact message is upserted by ref. (No code change needed — the artifact case spreads the whole object; covered by a new passthrough test.)
- [x] The contract-conformance test serializes a Java **Artifact** carrying `meta` and validates it against the regenerated JSON Schema. (New assertion in `artifactMessagesConform`; uses an existing kind since S1 adds no new ArtifactKind literals.)
- [x] No existing test regresses. (Frontend: 20 files / 98 tests pass + `tsc --noEmit` clean. Java: conformance + watcher + scripted-source tests pass.)

**Status: complete.** `body`'s meaning now narrows to Markdown / `data:` URI only (documented in the contract + Java record). No new `ArtifactKind` literals — those arrive with S4 (`diagnostics`) and S5 (`metrics`).

## Blocked by

- None — can start immediately.
