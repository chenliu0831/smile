# One-command dev launcher for Smile Studio (`smile-studio` on PATH)

> Status: accepted & implemented (commit `9837f96c`). Scope: developer experience, NOT a distributable bundle.
>
> Implemented as `bin/smile-studio` + `bin/install-dev-launcher.sh`. Note `bin/` is gitignored,
> so both were `git add -f`'d — matching how the existing `bin/*.sh` launchers (smile.sh, setup.sh)
> are tracked.
>
> **Verified:** launcher shell logic tested in isolation (a stub `run.sh` recorder in a fake-repo
> layout) — cwd-preservation, symlink-safety (direct, relative, and PATH-symlink invocation), and
> `--rebuild` passthrough all pass. The full launch substance (daemon spawn config → real Clair
> agent → Bedrock → Titanic dataset → real EDA artifacts + checkpoint, surviving a WS reconnect)
> was confirmed headlessly; the only step not completed was the multi-step AutoML *finish*, blocked
> by an expired Bedrock token (credential lifetime, not a code issue — resume via
> `/tmp/smile-e2e-run/resume-e2e.sh` with a fresh token).

## Context

Classic Smile has a one-command feel: `bin/smile.sh` runs `sbt studio/stage` (sbt-native-packager `JavaAppPackaging`, main `smile.Main`) and then the generated `bin/smile` start script — one toolchain (JVM), JVM assumed present. We want Smile Studio's developer launch to feel the same: **one command, from anywhere.**

Today the launcher is `studio/run.sh`, invoked as `./studio/run.sh` from the repo. It already does the right things, in this order:
1. `export SMILE_STUDIO_LAUNCH_DIR="$PWD"` — captured **before any `cd`**. This is the agent's workspace (where it reads `./input/`, writes `logs/`, runs AutoML). The Rust shell reads it in `resolve_working_dir` (lib.rs); without it the daemon would inherit Tauri's binary cwd (`studio/app/src-tauri`, the source tree).
2. Resolve `REPO_ROOT` from the script's own location (`BASH_SOURCE`).
3. Non-fatally check the LLM credential env var (the app also accepts a session key pasted in Settings).
4. Build the daemon jar (`./gradlew :serve:quarkusBuild`) if missing or `--rebuild`.
5. `npm install` in `studio/app` if `node_modules` is missing.
6. `cd studio/app && exec npm run tauri:dev`.

The friction is purely *invocation*: you must `cd` to the repo and type the path. There is nothing wrong with the steps themselves. (Smile Studio is three toolchains — Gradle/JVM daemon, Node/Vite, Rust/Tauri — and the Rust shell spawns the JVM daemon at runtime; a *relocatable bundle* is a much larger, separate effort tracked elsewhere. This ADR is only the dev one-liner.)

## Decision

Ship a single PATH-installable launcher named **`smile-studio`** that a developer can run from any directory. It is a thin, **symlink-safe** wrapper that resolves its own real location → the repo root, then delegates to the existing `studio/run.sh` (which keeps doing the jar build / npm install / `tauri dev`). The wrapper changes *how the launcher is invoked*, not *what it does*.

Two invariants it must preserve:
- **Workspace = the caller's current directory.** `SMILE_STUDIO_LAUNCH_DIR` must capture the directory the developer was in when they typed `smile-studio`, NOT the repo or the bin dir. (`exec` does not change cwd, so delegating to `run.sh` preserves `$PWD` — `run.sh`'s existing `export …="$PWD"` already captures it correctly. The wrapper must not `cd` before delegating.)
- **Repo self-location must survive a PATH symlink.** When `smile-studio` is a symlink in `/usr/local/bin`, `BASH_SOURCE` is the symlink path; the wrapper must resolve the link to its real target before deriving the repo root. (`run.sh` today resolves `REPO_ROOT` from `BASH_SOURCE` *without* link resolution — fine when run as `./studio/run.sh`, but it would misresolve if symlinked directly. The wrapper does the link resolution and calls `run.sh` by absolute path, so `run.sh`'s own resolution stays correct and `run.sh` needs no change.)

### How it gets on PATH — sub-decision

Provide a committed launcher under `bin/` (mirroring `bin/smile.sh`) plus a tiny opt-in installer; do **not** auto-write to the user's PATH or shell profile.

- **Chosen:** `bin/smile-studio` (committed, symlink-safe, execs `studio/run.sh "$@"`) + `bin/install-dev-launcher.sh` that symlinks it into a PATH dir (default `/usr/local/bin`, overridable). The dev runs the installer once; thereafter `smile-studio` works from anywhere. Toolchain-neutral (pure shell), matches the classic `bin/` convention, and `--rebuild` etc. pass straight through.
- Documented alternative for those who prefer it: a shell alias (`alias smile-studio="/abs/path/to/repo/bin/smile-studio"`) — no installer needed.

## Considered Options

- **Symlink/wrapper launcher on PATH (chosen).** Smallest change, preserves both invariants, no new toolchain, mirrors classic `bin/`. The wrapper is the only new code; `run.sh` is reused as-is.
- **Root `package.json` with a `bin` + `npm link`.** Idiomatic for JS projects and gives `smile-studio` on PATH via npm. Rejected as the primary path: it introduces a repo-root `package.json` purely for a launcher, and `npm link`'s global shim resolves from the npm prefix — more moving parts than a symlink for no extra benefit here. (Easy to add later if a root npm workspace appears.)
- **Fold all prep into Tauri's `beforeDevCommand` so `tauri dev` is the one command.** Tauri runs `beforeDevCommand` automatically, so moving the gradle build + npm install there would make `tauri dev` self-sufficient. Rejected: `beforeDevCommand` runs from `studio/app`, which **loses the caller's workspace cwd** (breaks the `SMILE_STUDIO_LAUNCH_DIR` invariant), and it still requires `cd studio/app` to invoke. Good hygiene to move the *jar-freshness check* into `beforeDevCommand` eventually, but it can't own the workspace-capturing entry point.
- **`sbt`/`tauri build` packaged app.** Out of scope — that's the relocatable-bundle effort (embedded JRE, resource resolution, signing), not a dev one-liner.

## Consequences

- A developer types `smile-studio` from their dataset directory; that directory becomes the agent workspace, the jar builds if stale, and the app launches — matching the classic one-command feel within the dev (repo + toolchains present) context.
- Still requires the repo checkout, a JDK, Node/npm, and the Rust/Tauri toolchain — this is **not** a distributable. `run.sh` stays the single source of launch logic; the wrapper only adds an entry point.
- Credential behavior is unchanged: present env var → daemon starts; otherwise the app opens and the user pastes a key in Settings.
- Follow-up (optional, separate): move the jar-freshness check into `beforeDevCommand` so `cd studio/app && npm run tauri:dev` also self-heals; and a Windows equivalent (`smile-studio.cmd`) if Windows dev is a target.

## Implementation steps (for review — not yet done)

1. Add `bin/smile-studio` (committed, executable): resolve `BASH_SOURCE` through symlinks to its real path (portable `readlink`-loop or `realpath`/`python3 -c`, since macOS `readlink` lacks `-f`), derive `REPO_ROOT` from it, then `exec "$REPO_ROOT/studio/run.sh" "$@"` **without changing cwd**.
2. Add `bin/install-dev-launcher.sh`: symlink `bin/smile-studio` into a PATH dir (default `/usr/local/bin/smile-studio`; honor a `--prefix` / `$PREFIX` override; warn, don't sudo silently, if the target isn't writable). Idempotent.
3. Verify the workspace invariant: from an arbitrary dir, `smile-studio` launches and the daemon's `logs/` + `./input/` resolve under that dir (assert `SMILE_STUDIO_LAUNCH_DIR` == the caller's `$PWD`).
4. Verify symlink-safety: invoke via the installed `/usr/local/bin/smile-studio` symlink and confirm `REPO_ROOT` resolves to the real repo (not `/usr/local/bin`).
5. Pass-through check: `smile-studio --rebuild` forwards to `run.sh`.
6. Update `studio/run.sh` header + README/CLI docs to present `smile-studio` as the one-command dev launch (keep `./studio/run.sh` working as the underlying script).
