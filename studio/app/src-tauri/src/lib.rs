//! Smile Studio — Tauri Rust Core (the "Shell", ADR-0001).
//!
//! The Shell owns the OS and supervises a single headless Smile Daemon sidecar
//! (the evolved Quarkus `serve/` module). It:
//!   - persists LLM config (provider / base URL / model) in a Tauri store and the
//!     API key/token in the OS keychain (never returned to the Webview);
//!   - spawns the daemon JVM configured from that saved config + token, on a free
//!     loopback port, and reports readiness via `daemon_info` (ADR-0002);
//!   - the Webview then connects directly to the daemon's WebSocket.
//!
//! Deployment paths (daemon jar, `smile.home`, the agent working directory) come from
//! env vars with dev-friendly defaults, since they are not user-facing settings.

use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::net::TcpListener;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, State};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "settings.json";
const CONFIG_KEY: &str = "llm";
const KEYRING_SERVICE: &str = "dev.smile.studio";
const KEYRING_USER: &str = "llm-api-key";

/// LLM configuration the Webview can read/write (no secret here).
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct LlmConfig {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub has_key: bool,
}

/// Connection details the Webview needs to reach the daemon directly (ADR-0002).
#[derive(Serialize, Clone)]
pub struct DaemonInfo {
    pub port: u16,
    pub token: String,
    pub attached: bool,
}

/// The fully-resolved JVM invocation for the daemon — pure data so it is unit-testable.
#[derive(Debug, PartialEq)]
pub struct DaemonInvocation {
    pub args: Vec<String>,
    /// Environment overrides (the secret token lives here, never in args/logs).
    pub env: Vec<(String, String)>,
}

/// Maps an LLM provider to the env var its client reads the credential from.
fn token_env_var(provider: &str) -> &'static str {
    match provider {
        "bedrock" => "AWS_BEARER_TOKEN_BEDROCK",
        "openai" => "OPENAI_API_KEY",
        "gemini" => "GOOGLE_API_KEY",
        _ => "ANTHROPIC_API_KEY",
    }
}

/// Builds the daemon JVM invocation from config + token + deployment paths + port.
/// Pure: no I/O, no process spawn — this is the unit under test.
pub fn build_daemon_invocation(
    cfg: &LlmConfig,
    token: &str,
    jar: &str,
    smile_home: &str,
    port: u16,
) -> DaemonInvocation {
    let mut args = vec![
        "--add-opens".into(), "java.base/java.lang=ALL-UNNAMED".into(),
        "--add-opens".into(), "java.base/java.nio=ALL-UNNAMED".into(),
        "--enable-native-access=ALL-UNNAMED".into(),
        "-Dquarkus.http.host=127.0.0.1".into(),
        format!("-Dquarkus.http.port={port}"),
        // The daemon's AutoML WS needs no database; keep startup lean and dependency-free.
        "-Dquarkus.hibernate-orm.active=false".into(),
        "-Dsmile.daemon.engine=agent".into(),
        format!("-Dsmile.daemon.llm.provider={}", cfg.provider),
        format!("-Dsmile.daemon.llm.model={}", cfg.model),
        format!("-Dsmile.home={smile_home}"),
    ];
    if !cfg.base_url.is_empty() {
        args.push(format!("-Dsmile.daemon.llm.baseUrl={}", cfg.base_url));
    }
    args.push("-jar".into());
    args.push(jar.into());

    let mut env = Vec::new();
    if !token.is_empty() {
        env.push((token_env_var(&cfg.provider).to_string(), token.to_string()));
    }
    DaemonInvocation { args, env }
}

/// Live daemon process + port, held in Tauri managed state.
#[derive(Default)]
pub struct DaemonState(Mutex<Option<RunningDaemon>>);

pub struct RunningDaemon {
    child: Child,
    port: u16,
}

fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    // Listener drops here, freeing the port for the JVM (small benign race window).
    Ok(port)
}

fn wait_until_listening(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

// ---- Commands ----

#[tauri::command]
fn daemon_info(state: State<DaemonState>) -> DaemonInfo {
    let guard = state.0.lock().unwrap();
    match guard.as_ref() {
        Some(d) => DaemonInfo { port: d.port, token: String::new(), attached: true },
        None => DaemonInfo { port: 0, token: String::new(), attached: false },
    }
}

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
        Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .map_err(|e| e.to_string())?
            .set_password(&api_key)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Spawns the daemon JVM configured from the saved LLM config + keychain token, on a
/// free loopback port, and waits until it is listening. The agent's working directory
/// is `working_dir` (where `input/<dataset>.csv` lives). Returns the live connection info.
#[tauri::command]
fn start_daemon(
    app: tauri::AppHandle,
    state: State<DaemonState>,
    working_dir: String,
) -> Result<DaemonInfo, String> {
    {
        let guard = state.0.lock().unwrap();
        if let Some(d) = guard.as_ref() {
            return Ok(DaemonInfo { port: d.port, token: String::new(), attached: true });
        }
    }

    let cfg = get_llm_config(app)?;
    let token = Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .and_then(|e| e.get_password())
        .unwrap_or_default();

    // Deployment paths: env-overridable, dev defaults relative to the repo.
    let jar = std::env::var("SMILE_DAEMON_JAR")
        .unwrap_or_else(|_| "../../serve/build/quarkus-app/quarkus-run.jar".into());
    let smile_home = std::env::var("SMILE_HOME").unwrap_or_else(|_| "../..".into());

    let port = free_port()?;
    let inv = build_daemon_invocation(&cfg, &token, &jar, &smile_home, port);

    let mut cmd = Command::new("java");
    cmd.args(&inv.args).current_dir(&working_dir);
    for (k, v) in &inv.env {
        cmd.env(k, v);
    }
    let child = cmd.spawn().map_err(|e| format!("failed to spawn daemon: {e}"))?;

    if !wait_until_listening(port, Duration::from_secs(60)) {
        return Err("daemon did not start listening within 60s".into());
    }

    *state.0.lock().unwrap() = Some(RunningDaemon { child, port });
    Ok(DaemonInfo { port, token: String::new(), attached: true })
}

#[tauri::command]
fn stop_daemon(state: State<DaemonState>) {
    if let Some(mut d) = state.0.lock().unwrap().take() {
        let _ = d.child.kill();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(DaemonState::default())
        .on_window_event(|window, event| {
            // Kill the daemon when the main window closes.
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<DaemonState>() {
                    if let Some(mut d) = state.0.lock().unwrap().take() {
                        let _ = d.child.kill();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            daemon_info,
            get_llm_config,
            set_llm_config,
            start_daemon,
            stop_daemon
        ])
        .run(tauri::generate_context!())
        .expect("error while running Smile Studio");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(provider: &str, base_url: &str, model: &str) -> LlmConfig {
        LlmConfig {
            provider: provider.into(),
            base_url: base_url.into(),
            model: model.into(),
            has_key: false,
        }
    }

    #[test]
    fn bedrock_invocation_sets_engine_provider_baseurl_and_bearer_env() {
        let inv = build_daemon_invocation(
            &cfg("bedrock", "https://bedrock/v1", "openai.gpt-oss-120b"),
            "tok-123",
            "/x/quarkus-run.jar",
            "/repo",
            9999,
        );
        assert!(inv.args.contains(&"-Dsmile.daemon.engine=agent".to_string()));
        assert!(inv.args.contains(&"-Dsmile.daemon.llm.provider=bedrock".to_string()));
        assert!(inv.args.contains(&"-Dsmile.daemon.llm.baseUrl=https://bedrock/v1".to_string()));
        assert!(inv.args.contains(&"-Dsmile.daemon.llm.model=openai.gpt-oss-120b".to_string()));
        assert!(inv.args.contains(&"-Dquarkus.http.port=9999".to_string()));
        assert_eq!(inv.env, vec![("AWS_BEARER_TOKEN_BEDROCK".to_string(), "tok-123".to_string())]);
        // jar is the last arg, preceded by -jar
        assert_eq!(inv.args.last().unwrap(), "/x/quarkus-run.jar");
    }

    #[test]
    fn anthropic_uses_anthropic_api_key_and_omits_empty_base_url() {
        let inv = build_daemon_invocation(
            &cfg("anthropic", "", "claude-opus-4-8"),
            "sk-ant",
            "/x.jar",
            "/repo",
            8000,
        );
        assert_eq!(inv.env[0].0, "ANTHROPIC_API_KEY");
        assert!(!inv.args.iter().any(|a| a.starts_with("-Dsmile.daemon.llm.baseUrl")));
    }

    #[test]
    fn missing_token_yields_no_env_override() {
        let inv = build_daemon_invocation(
            &cfg("bedrock", "u", "m"), "", "/x.jar", "/repo", 8000,
        );
        assert!(inv.env.is_empty());
    }
}
