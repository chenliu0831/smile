#!/usr/bin/env bash
#
# One-line launcher for the Smile Studio desktop app.
#
#   studio/run.sh
#
# Builds the daemon jar and installs frontend deps if (and only if) they're missing,
# then launches the native Tauri app via `tauri dev`. The app spawns the daemon itself
# from your saved Settings (open ⚙ Settings once to configure the LLM provider/key).
#
# Flags:
#   --rebuild   force-rebuild the daemon jar even if it exists
#
set -euo pipefail

# Resolve the repo root from this script's location (studio/run.sh -> repo root).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$REPO_ROOT/studio/app"
JAR="$REPO_ROOT/serve/build/quarkus-app/quarkus-run.jar"

REBUILD=0
[[ "${1:-}" == "--rebuild" ]] && REBUILD=1

echo "▸ Smile Studio launcher (repo: $REPO_ROOT)"

# 1. Daemon jar — build if missing or --rebuild.
if [[ ! -f "$JAR" || "$REBUILD" == "1" ]]; then
  echo "▸ Building the Smile Daemon jar (serve:quarkusBuild)…"
  ( cd "$REPO_ROOT" && ./gradlew :serve:quarkusBuild -q )
else
  echo "▸ Daemon jar present (use --rebuild to force)."
fi

# 2. Frontend deps — install if missing.
if [[ ! -d "$APP_DIR/node_modules" ]]; then
  echo "▸ Installing frontend dependencies (npm install)…"
  ( cd "$APP_DIR" && npm install )
else
  echo "▸ Frontend deps present."
fi

# 3. Launch the native app. `tauri dev` runs Vite + builds/launches the Rust shell.
echo "▸ Launching the desktop app (tauri dev)…"
echo "  Open ⚙ Settings once to set your LLM provider/base URL/model/key,"
echo "  then Load Dataset and chat with Clair."
cd "$APP_DIR"
exec npm run tauri:dev
