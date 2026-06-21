/**
 * @smile/contract — the single source of truth for the Smile Studio wire contract.
 *
 * Authored once in TypeBox (Option B of the architecture review). Consumers:
 *   - app/ (Webview):    imports the TS types + runtime validators from here.
 *   - serve/ (Daemon):   validates its Java records against schema/*.json (generated).
 *   - src-tauri/ (Shell): validates its Rust structs against schema/*.json (generated).
 *
 * The transport is unchanged (JSON over WebSocket + REST, ADR-0002). This module
 * single-sources the SHAPES only — generate the JSON Schema with `npm run gen`.
 */
export * from "./daemonMessage";
export * from "./rest";
export * from "./tauri";
export * from "./validate";
