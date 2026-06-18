/**
 * Decides how the webview reaches the daemon (ADR-0002). In a Tauri window it asks
 * the Rust Shell for `{ port, token, attached }` via the `daemon_info` command; if a
 * real daemon is attached it builds a WebSocket connection, otherwise it falls back
 * to the in-process mock so the experience always runs. A `?ws=<url>` query override
 * lets a browser point straight at a locally-run daemon for development.
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

async function daemonInfo(): Promise<DaemonInfo | null> {
  if (!inTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<DaemonInfo>("daemon_info");
  } catch {
    return null;
  }
}

/** Build the connection to use for a run, preferring a real daemon when present. */
export async function connectRun(stepMs = 350): Promise<RunConnection> {
  // Explicit dev override: ?ws=ws://127.0.0.1:8888/ws/run
  const override =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("ws")
      : null;
  if (override) return new WebSocketRunConnection(override);

  const info = await daemonInfo();
  if (info?.attached && info.port > 0) {
    const url = `ws://127.0.0.1:${info.port}/ws/run`;
    return new WebSocketRunConnection(url);
  }

  // Fallback: in-process mock daemon. start() is deferred to the caller (after
  // subscribe) so the synchronous run-started message is never missed.
  return new MockRunPlayer(churnRunScript, { stepMs });
}
