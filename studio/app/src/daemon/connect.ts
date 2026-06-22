/**
 * Decides how the webview reaches the daemon (ADR-0002). In a Tauri window it asks the
 * Rust Shell to spawn+configure the daemon from saved Settings (`start_daemon`), then
 * connects to its loopback WebSocket. A `?ws=<url>` query override points straight at a
 * manually-run daemon.
 *
 * There is NO demo/fake-run fallback: a real analysis must never be impersonated by scripted
 * data. When there is genuinely no daemon — plain browser dev (no Tauri shell), the daemon
 * failed to start (e.g. missing LLM credential), or it isn't attached — we return an ERROR
 * connection that surfaces the real reason. The only non-daemon connection is the explicit
 * test harness, which injects its own factory (see test/harness.ts).
 */
import { WebSocketRunConnection, type RunConnection } from "./wsClient";
import { ErrorRunConnection } from "./errorConnection";

/** How the session is connected — surfaced to the UI so a failure can't masquerade as real. */
export type ConnectionMode = "daemon" | "error";

export interface RunConnectionResult {
  connection: RunConnection;
  mode: ConnectionMode;
}

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
 * Ask the Shell to start (or reuse) the daemon configured from saved Settings. Returns the
 * connection info on success, or the error MESSAGE on failure (so we can show the real
 * reason instead of a fake run).
 */
async function startDaemon(workingDir: string): Promise<DaemonInfo | { error: string }> {
  if (!inTauri()) return { error: "not in desktop app" };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<DaemonInfo>("start_daemon", { workingDir });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Build the connection to use for a run, preferring a real daemon when present. */
export async function connectRun(workingDir = "."): Promise<RunConnectionResult> {
  // Explicit dev override: ?ws=ws://127.0.0.1:8888/ws/run
  const override =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("ws")
      : null;
  if (override) return { connection: new WebSocketRunConnection(override), mode: "daemon" };

  if (inTauri()) {
    const info = await startDaemon(workingDir);
    if ("error" in info) {
      // Desktop app, daemon failed: surface the real reason.
      return {
        connection: new ErrorRunConnection(
          `The analysis daemon could not start, so I can't analyze your data yet.\n\nReason: ${info.error}`,
        ),
        mode: "error",
      };
    }
    if (info.attached && info.port > 0) {
      return {
        connection: new WebSocketRunConnection(
          `ws://127.0.0.1:${info.port}/ws/run`,
          info.token || undefined,
        ),
        mode: "daemon",
      };
    }
    // Attached=false without an error: treat as a failure too.
    return {
      connection: new ErrorRunConnection("The analysis daemon is not available."),
      mode: "error",
    };
  }

  // No Tauri shell → genuinely no daemon to reach (plain browser dev). Surface it honestly
  // rather than playing a fake run; the desktop app is what spawns the daemon.
  return {
    connection: new ErrorRunConnection(
      "The analysis daemon is only available in the desktop app.",
    ),
    mode: "error",
  };
}
