/**
 * The Shell <-> Webview Tauri command payloads, authored once here. Mirrors the `serde`
 * structs in `app/src-tauri/src/lib.rs`. These cross the Tauri `invoke` IPC boundary as
 * JSON, NOT the daemon network seam — a separate, small, stable contract folded into the
 * shared module so all three languages (TS/Java/Rust) stay in sync (per the user's scope).
 *
 * WIRE-NAME WARNING: Rust serde serializes these fields in `snake_case` (no rename attr in
 * lib.rs), so the JSON keys are `base_url`, `has_key`, `file_name`, `size_bytes`,
 * `working_dir`. The TS side already maps these at the llmConfig/dataset client edge. The
 * schema models the WIRE shape (snake_case), which is what crosses `invoke`.
 */
import { Type as T, type Static, type TSchema } from "@sinclair/typebox";

function Open<P extends Record<string, TSchema>>(properties: P) {
  return T.Object(properties, { additionalProperties: true });
}

/** lib.rs `LlmConfig` — get_llm_config / set_llm_config. No secret here (has_key flag only). */
export const LlmConfig = Open({
  provider: T.String(),
  base_url: T.String(),
  model: T.String(),
  has_key: T.Boolean(),
});

/** lib.rs `DaemonInfo` — daemon_info / start_daemon result. */
export const DaemonInfo = Open({
  port: T.Number(),
  token: T.String(),
  attached: T.Boolean(),
});

/** lib.rs `LoadedDataset` — load_dataset result (cold-start: fresh session dir). */
export const LoadedDataset = Open({
  working_dir: T.String(),
  file_name: T.String(),
  size_bytes: T.Number(),
});

/** lib.rs `StagedDataset` — stage_dataset result (warm path: into the running daemon). */
export const StagedDataset = Open({
  file_name: T.String(),
  size_bytes: T.Number(),
});

export type LlmConfig = Static<typeof LlmConfig>;
export type DaemonInfo = Static<typeof DaemonInfo>;
export type LoadedDataset = Static<typeof LoadedDataset>;
export type StagedDataset = Static<typeof StagedDataset>;
