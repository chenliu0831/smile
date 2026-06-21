//! Cross-language contract conformance for the Shell's Tauri command payloads (Option B of
//! the architecture review). Serializes each payload struct with serde — exactly as it
//! crosses the `invoke` boundary to the Webview — and validates the JSON against the schema
//! generated from the `@smile/contract` TypeBox source of truth. If a Rust struct drifts
//! from the shared contract (a renamed/retyped field), this test fails.
//!
//! The schema files live in the sibling contract module; the path is resolved relative to
//! this crate's manifest dir, so the test is independent of the process working directory.
//! Regenerate the schemas with `npm run gen` in `studio/contract` after any contract change.

use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use smile_studio_lib::{DaemonInfo, LlmConfig, LoadedDataset, StagedDataset};

/// studio/contract/schema, resolved from this crate's manifest dir (src-tauri → app → studio).
fn schema_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2) // src-tauri -> app -> studio
        .expect("studio dir")
        .join("contract")
        .join("schema")
}

/// Serialize `value` as the Shell would and assert it matches `<schema_name>.json`.
fn assert_conforms<T: Serialize>(schema_name: &str, value: &T) {
    let path = schema_dir().join(format!("{schema_name}.json"));
    let schema_text = fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "schema not found at {} ({e}) — run `npm run gen` in studio/contract",
            path.display()
        )
    });
    let schema_json: serde_json::Value =
        serde_json::from_str(&schema_text).expect("schema is valid JSON");
    let validator = jsonschema::validator_for(&schema_json)
        .unwrap_or_else(|e| panic!("{schema_name}.json is not a usable schema: {e}"));

    let instance = serde_json::to_value(value).expect("payload serializes");
    let errors: Vec<String> = validator.iter_errors(&instance).map(|e| e.to_string()).collect();
    assert!(
        errors.is_empty(),
        "{} does not match {schema_name}.json:\n  serialized: {}\n  errors:\n    {}",
        std::any::type_name::<T>(),
        instance,
        errors.join("\n    "),
    );
}

#[test]
fn schema_dir_is_present() {
    let p = schema_dir().join("DaemonInfo.json");
    assert!(
        p.is_file(),
        "expected generated schema at {} — run `npm run gen` in studio/contract",
        p.display()
    );
}

#[test]
fn llm_config_conforms() {
    assert_conforms(
        "LlmConfig",
        &LlmConfig {
            provider: "bedrock".into(),
            base_url: "https://bedrock/v1".into(),
            model: "openai.gpt-oss-120b".into(),
            has_key: true,
        },
    );
}

#[test]
fn daemon_info_conforms() {
    assert_conforms(
        "DaemonInfo",
        &DaemonInfo { port: 8888, token: "sess-xyz".into(), attached: true },
    );
    // The not-attached shape the daemon_info command returns when no daemon is running.
    assert_conforms(
        "DaemonInfo",
        &DaemonInfo { port: 0, token: String::new(), attached: false },
    );
}

#[test]
fn loaded_dataset_conforms() {
    assert_conforms(
        "LoadedDataset",
        &LoadedDataset {
            working_dir: "/data/sessions/abc".into(),
            file_name: "titanic.csv".into(),
            size_bytes: 60302,
        },
    );
}

#[test]
fn staged_dataset_conforms() {
    assert_conforms(
        "StagedDataset",
        &StagedDataset { file_name: "customers.parquet".into(), size_bytes: 1024 },
    );
}
