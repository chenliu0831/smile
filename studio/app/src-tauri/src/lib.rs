//! Smile Studio — Tauri Rust Core (the "Shell", ADR-0001).
//!
//! The Shell owns the OS and supervises a single headless Smile Daemon sidecar
//! (the evolved Quarkus `serve/` module). It:
//!   - persists LLM config (provider / base URL / model) in a Tauri store;
//!   - reads the LLM credential from the provider's environment variable (e.g.
//!     `AWS_BEARER_TOKEN_BEDROCK`) — NOT the OS keychain. The keychain tied access to the
//!     app's code signature, so `tauri dev` re-prompted "grant access" on every rebuild;
//!     sourcing the token from the environment (the same var the daemon reads) removes that
//!     friction and the token is never persisted by the app at all;
//!   - spawns the daemon JVM configured from that saved config, on a free loopback port,
//!     and reports readiness via `daemon_info` (ADR-0002). The spawned JVM inherits the
//!     Shell's environment, so the credential reaches the daemon without being copied;
//!   - the Webview then connects directly to the daemon's WebSocket.
//!
//! Deployment paths (daemon jar, `smile.home`, the agent working directory) come from
//! env vars with dev-friendly defaults, since they are not user-facing settings.

use serde::{Deserialize, Serialize};
use std::net::TcpListener;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, State};
use tauri_plugin_store::StoreExt;
// `Manager` brings AppHandle::path() and try_state() into scope.

const STORE_FILE: &str = "settings.json";
const CONFIG_KEY: &str = "llm";

/// PYTHONPATH entry separator: ':' on unix, ';' on Windows.
#[cfg(windows)]
const PATH_SEP: &str = ";";
#[cfg(not(windows))]
const PATH_SEP: &str = ":";

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

/// Builds the daemon JVM invocation from config + credential + session token + paths.
/// Pure: no I/O, no process spawn — this is the unit under test.
///
/// `credential` is the LLM API key/bearer token (goes to the provider's env var, never
/// logged). `session_token` is the WS auth token (ADR-0002): passed as a JVM property so
/// the daemon enforces it, and also returned to the Webview so it can present it.
pub fn build_daemon_invocation(
    cfg: &LlmConfig,
    credential: &str,
    session_token: &str,
    jar: &str,
    smile_home: &str,
    ioa_jar: &str,
    ioa_overlay: &str,
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
        // CORS for the webview origins is baked into the daemon's application.properties
        // (it's a Quarkus build-time property, so runtime -D would have no effect).
        "-Dsmile.daemon.engine=agent".into(),
        format!("-Dsmile.home={smile_home}"),
    ];
    // Only pass provider/model/baseUrl when set — an empty -D value overrides the
    // daemon's own defaults with a blank string, which Quarkus rejects at startup.
    if !cfg.provider.is_empty() {
        args.push(format!("-Dsmile.daemon.llm.provider={}", cfg.provider));
    }
    if !cfg.model.is_empty() {
        args.push(format!("-Dsmile.daemon.llm.model={}", cfg.model));
    }
    if !cfg.base_url.is_empty() {
        args.push(format!("-Dsmile.daemon.llm.baseUrl={}", cfg.base_url));
    }
    if !session_token.is_empty() {
        args.push(format!("-Dsmile.daemon.token={session_token}"));
    }
    args.push("-jar".into());
    args.push(jar.into());

    let mut env = Vec::new();
    if !credential.is_empty() {
        env.push((token_env_var(&cfg.provider).to_string(), credential.to_string()));
    }
    // The agent's Python-backed skills run `python3 -m ioa.agent...`, which resolves
    // the `ioa` package by zipimport FROM the ioa-agent jar — so that jar must be on
    // PYTHONPATH. The agent's Bash tool spawns python as a subprocess that inherits
    // this JVM env, so setting it here is what makes every skill importable. Without
    // it: "ModuleNotFoundError: No module named 'ioa'".
    //
    // `ioa_overlay` (a repo-owned dir) is placed AHEAD of the jar so it shadows specific
    // skill scripts (`ioa` is a PEP-420 namespace package, so the two merge). Today it
    // carries a one-line pandas-2/numpy-2 fix for the summarize skill's analyze.py.
    let pythonpath = match (ioa_overlay.is_empty(), ioa_jar.is_empty()) {
        (false, false) => format!("{ioa_overlay}{SEP}{ioa_jar}", SEP = PATH_SEP),
        (true, false) => ioa_jar.to_string(),
        (false, true) => ioa_overlay.to_string(),
        (true, true) => String::new(),
    };
    if !pythonpath.is_empty() {
        env.push(("PYTHONPATH".to_string(), pythonpath));
    }
    DaemonInvocation { args, env }
}

/// Generates a random hex session token from the OS RNG (no extra crate needed).
fn generate_session_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    // Combine two RandomState-seeded hashers (each seeded from OS entropy) for 128 bits.
    let a = RandomState::new().build_hasher().finish();
    let b = RandomState::new().build_hasher().finish();
    format!("{a:016x}{b:016x}")
}

/// Live daemon process + port, held in Tauri managed state.
#[derive(Default)]
pub struct DaemonState(Mutex<Option<RunningDaemon>>);

pub struct RunningDaemon {
    child: Child,
    port: u16,
    token: String,
    /// The working dir the daemon was launched in (where its `input/<dataset>` lives).
    /// A reconnect requesting a DIFFERENT dir must relaunch, not reuse this one.
    working_dir: String,
}

/// Repo root, resolved from the crate's compile-time location (studio/app/src-tauri),
/// so daemon paths don't depend on the process working directory.
fn repo_root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3) // src-tauri -> app -> studio -> repo root
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| std::path::PathBuf::from("."))
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
        Some(d) => DaemonInfo { port: d.port, token: d.token.clone(), attached: true },
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
    // The credential is read from the provider's environment variable (e.g.
    // AWS_BEARER_TOKEN_BEDROCK), not stored by the app. has_key reflects whether that var
    // is set in the Shell's environment.
    cfg.has_key = !credential_for(&cfg.provider).is_empty();
    Ok(cfg)
}

#[tauri::command]
fn set_llm_config(
    app: tauri::AppHandle,
    provider: String,
    base_url: String,
    model: String,
) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let cfg = LlmConfig { provider, base_url, model, has_key: false };
    store.set(CONFIG_KEY, serde_json::to_value(&cfg).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// The LLM credential for a provider, read from its environment variable (never persisted).
fn credential_for(provider: &str) -> String {
    std::env::var(token_env_var(provider)).unwrap_or_default()
}

/// Spawns the daemon JVM configured from the saved LLM config + the credential read from
/// the provider's environment variable, on a free loopback port, and waits until it is
/// listening. The agent's working directory is `working_dir` (where `input/<dataset>.csv`
/// lives). Returns the live connection info.
#[tauri::command]
fn start_daemon(
    app: tauri::AppHandle,
    state: State<DaemonState>,
    working_dir: String,
) -> Result<DaemonInfo, String> {
    {
        let mut guard = state.0.lock().unwrap();
        if let Some(d) = guard.as_ref() {
            // Reuse the running daemon ONLY if it's already in the requested working dir.
            // Otherwise it's serving a stale dataset (a different input/) — kill it so we
            // relaunch below in the new dir. This is what makes a freshly-loaded dataset
            // actually reach the agent instead of the previous one.
            if d.working_dir == working_dir {
                return Ok(DaemonInfo { port: d.port, token: d.token.clone(), attached: true });
            }
            if let Some(mut stale) = guard.take() {
                let _ = stale.child.kill();
            }
        }
    }

    let cfg = get_llm_config(app)?;
    let credential = credential_for(&cfg.provider);
    // No credential in the environment → don't spawn a doomed daemon; the Webview falls
    // back to the mock. The user sets the provider's token env var (e.g.
    // AWS_BEARER_TOKEN_BEDROCK in ~/.zshrc) and relaunches.
    if credential.is_empty() {
        return Err(format!(
            "no LLM credential found — set {} in your environment (e.g. ~/.zshrc) and relaunch",
            token_env_var(&cfg.provider)
        ));
    }
    let session_token = generate_session_token();

    // Deployment paths: env-overridable. Defaults are resolved against the repo root
    // (CARGO_MANIFEST_DIR = studio/app/src-tauri → up 3 = repo root), NOT the process
    // cwd, since Tauri runs the binary from src-tauri/ where relative paths break.
    let repo_root = repo_root();
    let jar = std::env::var("SMILE_DAEMON_JAR").unwrap_or_else(|_| {
        repo_root.join("serve/build/quarkus-app/quarkus-run.jar").to_string_lossy().into_owned()
    });
    let smile_home = std::env::var("SMILE_HOME")
        .unwrap_or_else(|_| repo_root.to_string_lossy().into_owned());
    // The ioa-agent jar doubles as the Python package source for the agent's skills
    // (zipimport of `ioa.*`); it must be on the daemon's PYTHONPATH. Vendored under
    // serve/lib/ (the same jar Gradle puts on the daemon classpath).
    let ioa_jar = std::env::var("SMILE_IOA_JAR").unwrap_or_else(|_| {
        repo_root.join("serve/lib/ioa-agent-1.0.0.jar").to_string_lossy().into_owned()
    });
    // Repo-owned overlay, shadowed ahead of the jar (one-line summarize fix; see the
    // overlay's analyze.py header). Empty if the dir is absent so we don't add a bogus
    // PYTHONPATH entry.
    let ioa_overlay = std::env::var("SMILE_IOA_OVERLAY").unwrap_or_else(|_| {
        let p = repo_root.join("serve/ioa-overlay");
        if p.is_dir() { p.to_string_lossy().into_owned() } else { String::new() }
    });

    let port = free_port()?;
    let inv = build_daemon_invocation(
        &cfg, &credential, &session_token, &jar, &smile_home, &ioa_jar, &ioa_overlay, port,
    );

    let mut cmd = Command::new("java");
    cmd.args(&inv.args).current_dir(&working_dir);
    for (k, v) in &inv.env {
        cmd.env(k, v);
    }
    let child = cmd.spawn().map_err(|e| format!("failed to spawn daemon: {e}"))?;

    if !wait_until_listening(port, Duration::from_secs(60)) {
        return Err("daemon did not start listening within 60s".into());
    }

    *state.0.lock().unwrap() = Some(RunningDaemon {
        child,
        port,
        token: session_token.clone(),
        working_dir,
    });
    Ok(DaemonInfo { port, token: session_token, attached: true })
}

#[tauri::command]
fn stop_daemon(state: State<DaemonState>) {
    if let Some(mut d) = state.0.lock().unwrap().take() {
        let _ = d.child.kill();
    }
}

/// Result of loading a dataset: the working directory the daemon should run in
/// (its `input/` holds the copied file) plus display metadata for the UI.
#[derive(Serialize)]
pub struct LoadedDataset {
    /// Absolute working directory; the agent's ./input/ convention resolves here.
    pub working_dir: String,
    /// The dataset file name as the agent will see it (input/<file>).
    pub file_name: String,
    pub size_bytes: u64,
}

/// Copies a chosen dataset file into a fresh session working dir's `input/` folder and
/// returns that working dir. The agent's skills read `./input/<file>` (ADR-0005), so no
/// skill change is needed — the daemon just runs with this as its CWD. A new session
/// dir per load keeps datasets isolated and avoids stale Conversation context.
#[tauri::command]
fn load_dataset(
    app: tauri::AppHandle,
    state: State<DaemonState>,
    source_path: String,
) -> Result<LoadedDataset, String> {
    use std::path::Path;
    let src = Path::new(&source_path);
    if !src.is_file() {
        return Err(format!("not a file: {source_path}"));
    }
    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("invalid file name")?
        .to_string();

    // Session dir under the app data dir: <data>/sessions/<token>/input/<file>.
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("sessions")
        .join(generate_session_token());
    let input_dir = base.join("input");
    std::fs::create_dir_all(&input_dir).map_err(|e| e.to_string())?;
    let dest = input_dir.join(&file_name);
    std::fs::copy(src, &dest).map_err(|e| format!("copy failed: {e}"))?;
    let size_bytes = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);

    // A new dataset means a fresh session — stop any running daemon so the next
    // start_daemon launches in the new working dir.
    if let Some(mut d) = state.0.lock().unwrap().take() {
        let _ = d.child.kill();
    }

    Ok(LoadedDataset {
        working_dir: base.to_string_lossy().to_string(),
        file_name,
        size_bytes,
    })
}

/// Result of staging a dataset into the RUNNING daemon's working dir (no restart).
/// Fields are `pub` for parity with `LoadedDataset` and so the contract-conformance test
/// can construct one (the shape is validated against the shared JSON Schema).
#[derive(serde::Serialize)]
pub struct StagedDataset {
    /// The file name as the agent sees it under ./input/ (ADR-0005 convention).
    pub file_name: String,
    pub size_bytes: u64,
}

/// Copies a chosen dataset file into the ALREADY-RUNNING daemon's `input/` folder so the
/// agent can read `./input/<file>` (ADR-0005) WITHOUT a JVM restart or a new session — the
/// fast unified "Add data" path. Errors if no daemon is running (the caller should fall back
/// to load_dataset, which launches one). Unlike load_dataset, this preserves the live
/// conversation + shared DuckDB session.
#[tauri::command]
fn stage_dataset(
    state: State<DaemonState>,
    source_path: String,
) -> Result<StagedDataset, String> {
    use std::path::Path;
    let src = Path::new(&source_path);
    if !src.is_file() {
        return Err(format!("not a file: {source_path}"));
    }
    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("invalid file name")?
        .to_string();

    // Stage into the running daemon's working_dir/input/ — no restart, session preserved.
    let working_dir = {
        let guard = state.0.lock().unwrap();
        match guard.as_ref() {
            Some(d) => d.working_dir.clone(),
            None => return Err("no running daemon to stage into".into()),
        }
    };
    let input_dir = Path::new(&working_dir).join("input");
    std::fs::create_dir_all(&input_dir).map_err(|e| e.to_string())?;
    let dest = input_dir.join(&file_name);
    std::fs::copy(src, &dest).map_err(|e| format!("copy failed: {e}"))?;
    let size_bytes = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    Ok(StagedDataset { file_name, size_bytes })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
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
            stop_daemon,
            load_dataset,
            stage_dataset
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
    fn bedrock_invocation_sets_engine_provider_baseurl_bearer_env_and_session_token() {
        let inv = build_daemon_invocation(
            &cfg("bedrock", "https://bedrock/v1", "openai.gpt-oss-120b"),
            "tok-123",
            "sess-xyz",
            "/x/quarkus-run.jar",
            "/repo",
            "/repo/serve/lib/ioa-agent-1.0.0.jar",
            "/repo/serve/ioa-overlay",
            9999,
        );
        assert!(inv.args.contains(&"-Dsmile.daemon.engine=agent".to_string()));
        assert!(inv.args.contains(&"-Dsmile.daemon.llm.provider=bedrock".to_string()));
        assert!(inv.args.contains(&"-Dsmile.daemon.llm.baseUrl=https://bedrock/v1".to_string()));
        assert!(inv.args.contains(&"-Dsmile.daemon.llm.model=openai.gpt-oss-120b".to_string()));
        assert!(inv.args.contains(&"-Dquarkus.http.port=9999".to_string()));
        assert!(inv.args.contains(&"-Dsmile.daemon.token=sess-xyz".to_string()));
        // The LLM credential goes to the provider env var, never an arg.
        assert!(inv.env.contains(&("AWS_BEARER_TOKEN_BEDROCK".to_string(), "tok-123".to_string())));
        assert!(!inv.args.iter().any(|a| a.contains("tok-123")));
        // jar is the last arg, preceded by -jar
        assert_eq!(inv.args.last().unwrap(), "/x/quarkus-run.jar");
    }

    #[test]
    fn anthropic_uses_anthropic_api_key_and_omits_empty_base_url() {
        let inv = build_daemon_invocation(
            &cfg("anthropic", "", "claude-opus-4-8"),
            "sk-ant",
            "sess",
            "/x.jar",
            "/repo",
            "/repo/serve/lib/ioa-agent-1.0.0.jar",
            "/repo/serve/ioa-overlay",
            8000,
        );
        assert!(inv.env.iter().any(|(k, _)| k == "ANTHROPIC_API_KEY"));
        assert!(!inv.args.iter().any(|a| a.starts_with("-Dsmile.daemon.llm.baseUrl")));
    }

    #[test]
    fn missing_credential_yields_no_env_override_but_keeps_session_token() {
        let inv = build_daemon_invocation(
            &cfg("bedrock", "u", "m"), "", "sess", "/x.jar", "/repo", "", "", 8000,
        );
        // No credential and no ioa jar/overlay => no env at all.
        assert!(inv.env.is_empty());
        assert!(inv.args.contains(&"-Dsmile.daemon.token=sess".to_string()));
    }

    #[test]
    fn pythonpath_puts_overlay_ahead_of_jar_so_fixed_scripts_shadow_the_jar() {
        // The agent's Python skills `import ioa` by zipimport from the jar; the overlay
        // dir must come FIRST so its fixed scripts win (PEP-420 namespace merge). Without
        // PYTHONPATH the daemon hits "No module named 'ioa'".
        let inv = build_daemon_invocation(
            &cfg("bedrock", "u", "m"),
            "tok",
            "sess",
            "/x.jar",
            "/repo",
            "/repo/serve/lib/ioa-agent-1.0.0.jar",
            "/repo/serve/ioa-overlay",
            8000,
        );
        let pythonpath = inv
            .env
            .iter()
            .find(|(k, _)| k == "PYTHONPATH")
            .map(|(_, v)| v.clone())
            .expect("PYTHONPATH must be set");
        let expected = format!("/repo/serve/ioa-overlay{PATH_SEP}/repo/serve/lib/ioa-agent-1.0.0.jar");
        assert_eq!(pythonpath, expected);
        // Overlay precedes the jar.
        assert!(pythonpath.find("ioa-overlay").unwrap() < pythonpath.find("ioa-agent-1.0.0.jar").unwrap());
    }

    #[test]
    fn pythonpath_falls_back_to_jar_only_when_no_overlay() {
        let inv = build_daemon_invocation(
            &cfg("bedrock", "u", "m"),
            "tok",
            "sess",
            "/x.jar",
            "/repo",
            "/repo/serve/lib/ioa-agent-1.0.0.jar",
            "",
            8000,
        );
        assert!(inv.env.contains(&(
            "PYTHONPATH".to_string(),
            "/repo/serve/lib/ioa-agent-1.0.0.jar".to_string()
        )));
    }

    #[test]
    fn session_tokens_are_unique_and_nonempty() {
        let a = generate_session_token();
        let b = generate_session_token();
        assert!(!a.is_empty());
        assert_ne!(a, b);
    }
}
