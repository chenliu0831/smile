#!/usr/bin/env bash
#
# Install the one-command Smile Studio dev launcher onto your PATH (ADR-0015).
#
#   bin/install-dev-launcher.sh [--prefix DIR]
#
# Symlinks bin/smile-studio into a PATH directory (default /usr/local/bin) so you can run
# `smile-studio` from anywhere. Idempotent: re-running updates the symlink. The symlink
# points back into this repo, so the launcher always uses the current checkout — `git pull`
# and it's up to date, no reinstall needed.
#
# Prefer not to touch /usr/local/bin? Skip this and add a shell alias instead:
#   alias smile-studio="$(pwd)/bin/smile-studio"   # from the repo root
set -euo pipefail

PREFIX="${PREFIX:-/usr/local/bin}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix) PREFIX="${2:?--prefix needs a directory}"; shift 2 ;;
    --prefix=*) PREFIX="${1#--prefix=}"; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "install-dev-launcher: unknown arg '$1'" >&2; exit 2 ;;
  esac
done

BIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER="$BIN_DIR/smile-studio"
TARGET="$PREFIX/smile-studio"

[[ -f "$LAUNCHER" ]] || { echo "install-dev-launcher: $LAUNCHER not found" >&2; exit 1; }
chmod +x "$LAUNCHER"

if [[ ! -d "$PREFIX" ]]; then
  echo "install-dev-launcher: $PREFIX does not exist." >&2
  echo "  Create it, choose another with --prefix DIR (must be on your PATH), or use a shell alias." >&2
  exit 1
fi

if [[ ! -w "$PREFIX" ]]; then
  echo "install-dev-launcher: $PREFIX is not writable by you." >&2
  echo "  Re-run with sudo, or: bin/install-dev-launcher.sh --prefix \"\$HOME/.local/bin\"" >&2
  echo "  (then ensure that dir is on your PATH), or use a shell alias instead." >&2
  exit 1
fi

ln -sf "$LAUNCHER" "$TARGET"
echo "▸ Linked $TARGET → $LAUNCHER"
if command -v smile-studio >/dev/null 2>&1 && [[ "$(command -v smile-studio)" == "$TARGET" ]]; then
  echo "▸ Ready: run 'smile-studio' from any directory (that dir becomes the agent workspace)."
else
  echo "⚠  Installed, but '$PREFIX' may not be on your PATH — add it, or invoke $TARGET directly."
fi
