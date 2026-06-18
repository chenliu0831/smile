/**
 * Decides how the webview reaches the daemon (ADR-0002). In a Tauri window it asks the
 * Rust Shell to spawn+configure the daemon from saved Settings (`start_daemon`), then
 * connects to its loopback WebSocket. Outside Tauri — or if the daemon can't start
 * (e.g. no LLM key configured) — it falls back to the in-process mock so the experience
 * always runs. A `?ws=<url>` query override points straight at a manually-run daemon.
 */
import { WebSocketRunConnection, type RunConnection } from "./wsClient";
import { MockRunPlayer } from "./mock/player";
import { churnRunScript } from "./mock/churnRun";

interface DaemonInfo {
  port: number;
  token: string;
  attached: boolean;
}

/** True when running inside a Tauri window (the Shell injects this global). */
function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Ask the Shell to start (or reuse) the daemon configured from saved Settings.
 * `workingDir` is the agent's working directory (where `input/<dataset>.csv` lives);
 * defaults to the Shell's own default when omitted.
 */
async function startDaemon(workingDir: string): Promise<DaemonInfo | null> {
  if (!inTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<DaemonInfo>("start_daemon", { workingDir });
  } catch {
    // Daemon couldn't start (e.g. no key configured yet) — caller falls back to mock.
    return null;
  }
}

/** Build the connection to use for a run, preferring a real daemon when present. */
export async function connectRun(stepMs = 350, workingDir = "."): Promise<RunConnection> {
  // Explicit dev override: ?ws=ws://127.0.0.1:8888/ws/run
  const override =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("ws")
      : null;
  if (override) return new WebSocketRunConnection(override);

  const info = await startDaemon(workingDir);
  if (info?.attached && info.port > 0) {
    return new WebSocketRunConnection(`ws://127.0.0.1:${info.port}/ws/run`);
  }

  // Fallback: in-process mock daemon. start() is deferred to the caller (after
  // subscribe) so the synchronous run-started message is never missed.
  return new MockRunPlayer(churnRunScript, { stepMs });
}
