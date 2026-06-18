//! Smile Studio — Tauri Rust Core (the "Shell", ADR-0001).
//!
//! The Shell owns the OS and supervises a single headless Smile Daemon sidecar
//! (the evolved Quarkus `serve/` module). The Webview talks to the Shell over
//! `invoke` for control/lifecycle, and connects directly to the daemon's loopback
//! WebSocket for high-throughput streams (ADR-0002).
//!
//! LLM configuration (provider / base URL / model) is persisted in a Tauri store;
//! the secret (API key / Bedrock bearer token) is kept in the OS keychain and never
//! returned to the Webview after it is saved — the Webview only learns whether a key
//! is present. This mirrors Smile Studio's Settings dialog (provider, key, base URL,
//! model) while keeping the secret out of the web layer.

use keyring::Entry;
use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "settings.json";
const CONFIG_KEY: &str = "llm";
const KEYRING_SERVICE: &str = "dev.smile.studio";
const KEYRING_USER: &str = "llm-api-key";

/// LLM configuration the Webview can read/write (no secret here).
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct LlmConfig {
    /// `anthropic` | `openai` | `gemini` | `bedrock`.
    pub provider: String,
    /// Base URL override (required for `bedrock`; optional otherwise).
    pub base_url: String,
    /// Model id.
    pub model: String,
    /// Whether an API key/token is stored in the keychain (the value itself is never returned).
    #[serde(default)]
    pub has_key: bool,
}

/// Connection details the Webview needs to reach the daemon directly (ADR-0002).
#[derive(Serialize)]
pub struct DaemonInfo {
    pub port: u16,
    pub token: String,
    pub attached: bool,
}

#[tauri::command]
fn daemon_info() -> DaemonInfo {
    // V0 stub: a real implementation spawns the JVM sidecar with the saved LlmConfig,
    // waits for its loopback port, and mints a session token here.
    DaemonInfo { port: 0, token: String::new(), attached: false }
}

/// Returns the saved LLM config (without the secret), reporting whether a key exists.
#[tauri::command]
fn get_llm_config(app: tauri::AppHandle) -> Result<LlmConfig, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let mut cfg: LlmConfig = store
        .get(CONFIG_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    cfg.has_key = Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .and_then(|e| e.get_password())
        .is_ok();
    Ok(cfg)
}

/// Saves the LLM config. The `api_key` (when non-empty) goes to the OS keychain;
/// the provider/base URL/model go to the store. An empty `api_key` leaves any
/// existing stored key untouched.
#[tauri::command]
fn set_llm_config(
    app: tauri::AppHandle,
    provider: String,
    base_url: String,
    model: String,
    api_key: String,
) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let cfg = LlmConfig { provider, base_url, model, has_key: false };
    store.set(CONFIG_KEY, serde_json::to_value(&cfg).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())?;

    if !api_key.is_empty() {
        let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
        entry.set_password(&api_key).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![daemon_info, get_llm_config, set_llm_config])
        .run(tauri::generate_context!())
        .expect("error while running Smile Studio");
}
