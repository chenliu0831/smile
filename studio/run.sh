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

# The daemon reads the LLM credential from an environment variable (e.g.
# AWS_BEARER_TOKEN_BEDROCK), and the Tauri app passes its environment to the spawned JVM.
# A GUI launched from Finder/Dock does NOT inherit your shell profile, so source ~/.zshrc
# here and verify the token is set — otherwise the app silently can't start the daemon and
# shows the "No daemon" badge instead of analyzing your data.
if [[ -z "${AWS_BEARER_TOKEN_BEDROCK:-}" && -f "$HOME/.zshrc" ]]; then
  # shellcheck disable=SC1091
  set +u; source "$HOME/.zshrc" >/dev/null 2>&1 || true; set -u
fi
if [[ -z "${AWS_BEARER_TOKEN_BEDROCK:-}" ]]; then
  echo "⚠  AWS_BEARER_TOKEN_BEDROCK is not set — the app will run in 'No daemon' mode and"
  echo "   cannot analyze real data. Export it (e.g. in ~/.zshrc) and re-run, or set another"
  echo "   provider's token (OPENAI_API_KEY / GOOGLE_API_KEY / ANTHROPIC_API_KEY)."
else
  export AWS_BEARER_TOKEN_BEDROCK
  echo "▸ LLM credential detected (AWS_BEARER_TOKEN_BEDROCK) — daemon can start."
fi

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
