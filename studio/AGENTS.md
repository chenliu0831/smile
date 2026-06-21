# AGENTS.md — Smile Studio (Tauri frontend + daemon seam)

Context for AI coding agents working in `studio/` and the `serve/` daemon it drives.
Complements the root `AGENTS.md` (Java/Gradle); this covers the Webview/Shell/contract.

## 🧩 The shared wire contract — READ THIS BEFORE EDITING THE PROTOCOL

The daemon↔webview wire contract is **single-sourced** in `studio/contract/`
(`@smile/contract`, authored in TypeBox). It generates the JSON Schema that all three
components validate against. The transport is plain JSON over WebSocket + REST (ADR-0002) —
the contract module single-sources the *shapes*, not the transport.

**The three components that must agree on the contract:**
- **Webview** (`studio/app`, TS) — imports types via `@smile/contract`, re-exported through
  `app/src/daemon/protocol.ts`.
- **Daemon** (`serve`, Java) — `serve/.../daemon/DaemonMessage.java` + the JAX-RS REST records.
- **Shell** (`studio/app/src-tauri`, Rust) — the Tauri command-payload structs in `lib.rs`.

The Java records and Rust structs are **hand-written and validated against the schema**, not
generated from it. So if you change one side, you must change the source of truth and the
other side, then verify.

### When you touch the protocol, ALWAYS:

1. Edit the TypeBox source in `studio/contract/src/` (`daemonMessage.ts` / `rest.ts` / `tauri.ts`).
2. `cd studio/contract && npm run gen` — regenerate `schema/*.json`. **Commit the regenerated files.**
3. Mirror the change in the Java records (`serve`) and/or Rust structs (`src-tauri`).
4. **Run the verifier** (see below). It is the gate that proves the three sides still agree.

If you change ONLY the Java daemon or ONLY the Rust shell (e.g. a new field on a wire
record), you still owe steps 1–2 + the verifier — the schema is the source of truth, not the
Java/Rust code.

## ✅ Verifying contract conformance (local — there is NO CI for this)

There is deliberately no CI wiring: the daemon's `ioa-agent` jar is gitignored, so `serve/`
can't compile in a clean CI checkout. Conformance is a **local agentic check**:

```sh
studio/contract/verify.sh          # fast (<1s): schema is current + golden frames validate
studio/contract/verify.sh --all     # also runs the TS / Java / Rust conformance tests
```

- Run the **fast** check after any edit to `studio/contract/` or `app/src/daemon/protocol.ts`.
- Run **`--all`** before committing a protocol change, or after editing a Java record /
  Rust payload struct.
- A check whose toolchain is absent (e.g. Java when the ioa jar isn't present) is **skipped,
  not failed** — and the script says so. Don't read a skip as a pass.

The individual conformance tests, if you want to run one directly:
- TS golden frames: `cd studio/contract && npm test`
- Java daemon: `./gradlew :serve:test --tests "smile.daemon.ContractConformanceTest"`
- Rust shell: `cd studio/app/src-tauri && cargo test --test contract_conformance`

## 🛠 Studio commands

- **Webview tests:** `cd studio/app && npx vitest run`
- **Webview typecheck:** `cd studio/app && npx tsc --noEmit`
- **Rust shell tests:** `cd studio/app/src-tauri && cargo test`
- **Run the daemon (agent mode):** see `serve/AGENT-MODE.md` (needs the ioa jar + LLM creds).

## ⚠️ Dos and Don'ts

- **DO** keep the transport JSON-over-WS/REST unchanged unless an ADR says otherwise.
- **DO** model optional *nested*-record fields as nullable — the daemon emits explicit
  `null` for them (only top-level message fields are dropped via `@JsonInclude(NON_NULL)`).
  See `studio/contract/src/daemonMessage.ts` (`Opt()` helper) for the why.
- **DON'T** hand-edit `studio/contract/schema/*.json` — they are generated. Edit the TypeBox
  source and run `npm run gen`.
- **DON'T** add a field to `DaemonMessage.java` or a Rust payload without updating the
  TypeBox source — the verifier will catch it, but the contract should lead, not follow.

See `studio/contract/README.md` for the full design rationale and the codegen/ConnectRPC
alternatives that were evaluated and deferred.
