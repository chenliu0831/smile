/**
 * The typed contract between the Smile Daemon and the Webview (ADR-0002, ADR-0006).
 *
 * SINGLE SOURCE OF TRUTH: these types are now authored ONCE in `@smile/contract` (TypeBox)
 * and re-exported here so every existing `../daemon/protocol` import keeps working
 * unchanged. The same definitions generate the JSON Schema the Java daemon and Rust Shell
 * validate against — front and back can no longer silently drift (Option B of the
 * architecture review). The transport is unchanged: JSON over WebSocket, with bulk columnar
 * data carried out-of-band as Arrow frames referenced by `ArrowRef`.
 *
 * To change the protocol, edit `studio/contract/src/daemonMessage.ts`, run `npm run gen`,
 * and the TS types, the JSON Schema, and the cross-language conformance tests all follow.
 *
 * Naming follows CONTEXT.md: AutoML Run, Candidate, Run Artifacts, DataViz call, Gate.
 */
export type {
  StageStatus,
  StageProgress,
  ArrowRef,
  DataVizSpec,
  ArtifactKind,
  Artifact,
  ToolCall,
  Question,
  Todo,
  GateKind,
  Gate,
  ChatTurn,
  DaemonMessage,
  WebviewReply,
} from "@smile/contract";
