//! Smile Studio — Tauri Rust Core (the "Shell", ADR-0001).
//!
//! The Shell owns the OS and supervises a single headless Smile Daemon sidecar
//! (the evolved Quarkus `serve/` module). The Webview talks to the Shell over
//! `invoke` for control/lifecycle, and (once the real daemon is wired) connects
//! directly to the daemon's loopback WebSocket for high-throughput streams using
//! a Shell-minted session token (ADR-0002).
//!
//! V0: the daemon lifecycle is stubbed. `daemon_info` returns the connection seam
//! the Webview will use; the mock daemon currently runs in-process in the Webview.

use serde::Serialize;

/// Connection details the Webview needs to reach the daemon directly (ADR-0002).
#[derive(Serialize)]
pub struct DaemonInfo {
    /// Loopback port the daemon's WebSocket/REST server binds to.
    pub port: u16,
    /// Per-session token the Webview presents when connecting.
    pub token: String,
    /// Whether a real daemon is attached yet (false in V0 -> Webview uses the mock).
    pub attached: bool,
}

/// Control-plane command: hand the Webview the daemon connection seam.
#[tauri::command]
fn daemon_info() -> DaemonInfo {
    // V0 stub: a real implementation spawns the JVM sidecar, waits for its
    // loopback port, and mints a session token here.
    DaemonInfo {
        port: 0,
        token: String::new(),
        attached: false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![daemon_info])
        .run(tauri::generate_context!())
        .expect("error while running Smile Studio");
}
