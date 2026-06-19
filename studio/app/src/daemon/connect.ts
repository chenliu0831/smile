/**
 * Decides how the webview reaches the daemon (ADR-0002). In a Tauri window it asks the
 * Rust Shell to spawn+configure the daemon from saved Settings (`start_daemon`), then
 * connects to its loopback WebSocket. A `?ws=<url>` query override points straight at a
 * manually-run daemon.
 *
 * CRITICAL: in the desktop app we must NEVER silently fall back to the scripted churn
 * demo — it ignores the user's prompt AND their loaded dataset, so a real analysis request
 * would play fake churn results over their data. If the daemon can't start (e.g. the LLM
 * credential isn't in the app's environment), we return an ERROR connection that surfaces
 * the real reason. The in-process mock is reserved for plain browser dev (no Tauri shell,
 * so there is genuinely no daemon to reach), and is clearly labelled as demo mode.
 */
import { WebSocketRunConnection, type RunConnection } from "./wsClient";
import { MockRunPlayer } from "./mock/player";
import { ErrorRunConnection } from "./errorConnection";
import { churnRunScript } from "./mock/churnRun";

/** How the session is connected — surfaced to the UI so demo data can't masquerade as real. */
export type ConnectionMode = "daemon" | "demo" | "error";

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
 * reason instead of a fake demo).
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
export async function connectRun(stepMs = 350, workingDir = "."): Promise<RunConnectionResult> {
  // Explicit dev override: ?ws=ws://127.0.0.1:8888/ws/run
  const override =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("ws")
      : null;
  if (override) return { connection: new WebSocketRunConnection(override), mode: "daemon" };

  if (inTauri()) {
    const info = await startDaemon(workingDir);
    if ("error" in info) {
      // Desktop app, daemon failed: surface the real reason. Do NOT play the churn demo.
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
    // Attached=false without an error: treat as a failure too, not a silent demo.
    return {
      connection: new ErrorRunConnection("The analysis daemon is not available."),
      mode: "error",
    };
  }

  // Browser dev only (no Tauri shell → genuinely no daemon): the scripted demo, clearly
  // labelled. start() is deferred to the caller (after subscribe) so the greeting is kept.
  return {
    connection: new MockRunPlayer(churnRunScript, {
      stepMs,
      greeting:
        "Hi, I'm Clair — your data-science analyst. (Demo mode: this is a scripted sample run; launch the desktop app to analyze real data.)",
    }),
    mode: "demo",
  };
}
