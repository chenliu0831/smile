#!/usr/bin/env bash
#
# verify.sh — local contract-conformance check for agentic coding.
#
# The wire contract is authored ONCE in @smile/contract (TypeBox) and every component
# validates against the generated JSON Schema. This script runs those checks locally so a
# coding agent (or a human) can confirm front and back haven't drifted — there is NO CI
# wiring for this (the daemon's ioa-agent jar is gitignored, so serve/ can't even compile in
# a clean CI checkout; conformance is a local concern).
#
# Usage:
#   studio/contract/verify.sh           Fast (<1s): the contract module self-checks —
#                                        schema is current + golden frames still validate.
#   studio/contract/verify.sh --all      Also runs every consumer's conformance test:
#                                        TS app typecheck, Java daemon, Rust shell.
#   studio/contract/verify.sh --help
#
# Exit code is non-zero if any check fails, so it can gate a commit. A check that genuinely
# cannot run in this environment (e.g. the Java daemon when its jar is absent) is SKIPPED,
# not failed — and that is reported loudly so a skip is never mistaken for a pass.

set -uo pipefail

CONTRACT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STUDIO_DIR="$(cd "$CONTRACT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$STUDIO_DIR/.." && pwd)"
APP_DIR="$STUDIO_DIR/app"
TAURI_DIR="$APP_DIR/src-tauri"
IOA_JAR="$REPO_ROOT/serve/lib/ioa-agent-1.0.0.jar"

ALL=0
case "${1:-}" in
  --all) ALL=1 ;;
  --help|-h)
    sed -n '3,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0 ;;
  "") ;;
  *) echo "unknown arg: $1 (try --help)" >&2; exit 2 ;;
esac

if [ -t 1 ]; then
  G="\033[32m"; R="\033[31m"; Y="\033[33m"; B="\033[1m"; X="\033[0m"
else
  G=""; R=""; Y=""; B=""; X=""
fi

fail=0
skipped=0

# run <label> <dir> <cmd...> — runs a check, prints ✓/✗, records failure.
run() {
  local label="$1" dir="$2"; shift 2
  printf "  %s … " "$label"
  local out
  if out=$( cd "$dir" && "$@" 2>&1 ); then
    printf "${G}✓${X}\n"
  else
    printf "${R}✗${X}\n"
    echo "$out" | sed 's/^/      /'
    fail=1
  fi
}

skip() { # skip <label> <reason>
  printf "  %s … ${Y}⊘ skipped${X} (%s)\n" "$1" "$2"
  skipped=1
}

echo -e "${B}contract verify${X}  (root: $REPO_ROOT)"

# ---- Deps (one-time) ------------------------------------------------------
if [ ! -d "$CONTRACT_DIR/node_modules" ]; then
  echo "  installing @smile/contract deps (first run) …"
  ( cd "$CONTRACT_DIR" && npm install --silent ) || { echo "npm install failed" >&2; exit 1; }
fi

# ---- Fast: contract module self-consistency -------------------------------
echo -e "${B}fast — contract module${X}"
# Schema committed in schema/*.json must match the TypeBox source (catches "edited the
# contract but forgot to regenerate").
run "schema is current (gen:check)" "$CONTRACT_DIR" npm run --silent gen:check
# Golden-frame corpus: real captured daemon bytes still validate against the schema.
run "golden frames validate"        "$CONTRACT_DIR" npm test --silent

# ---- --all: every consumer conforms ---------------------------------------
if [ "$ALL" = 1 ]; then
  echo -e "${B}all — consumers${X}"

  # TS consumer: the app imports the contract via protocol.ts; a typecheck proves every
  # importer still compiles against it.
  if [ -d "$APP_DIR/node_modules" ]; then
    run "TS app typecheck"  "$APP_DIR" npx tsc --noEmit
  else
    skip "TS app typecheck" "studio/app/node_modules missing — run 'npm install' in studio/app"
  fi

  # Java consumer: the daemon serializes its records and validates them vs the schema.
  # Needs the gitignored ioa-agent jar to compile serve/ at all.
  if [ -f "$IOA_JAR" ]; then
    run "Java daemon conformance" "$REPO_ROOT" \
      ./gradlew --quiet --console=plain :serve:test --tests "smile.daemon.ContractConformanceTest"
  else
    skip "Java daemon conformance" "serve/lib/ioa-agent-1.0.0.jar absent (copy from the release dist)"
  fi

  # Rust consumer: the shell validates its Tauri command-payload structs vs the schema.
  if command -v cargo >/dev/null 2>&1; then
    run "Rust shell conformance" "$TAURI_DIR" cargo test --quiet --test contract_conformance
  else
    skip "Rust shell conformance" "cargo not on PATH"
  fi
fi

echo
if [ "$fail" = 1 ]; then
  echo -e "${R}${B}FAIL${X} — contract drift detected (see above)."
  exit 1
fi
if [ "$skipped" = 1 ]; then
  echo -e "${G}${B}PASS${X} — but some checks were ${Y}skipped${X}; run again where those toolchains exist."
else
  echo -e "${G}${B}PASS${X} — contract is consistent across all checked components."
fi
