/**
 * The Smile Daemon -> Webview streaming protocol, authored ONCE in TypeBox (Option B of
 * the architecture review). This module is the single source of truth: the TS types in
 * `app/src/daemon/protocol.ts` re-export from here, the canonical JSON Schema generated
 * by `scripts/gen-schema.ts` is validated by the Java daemon's round-trip test, and the
 * golden-frame corpus (Candidate 2) is validated against it in CI.
 *
 * Field-for-field mirror of `serve/.../daemon/DaemonMessage.java`. The transport is
 * unchanged (JSON over WebSocket, ADR-0002) — this only single-sources the SHAPES.
 *
 * Forward-compat: object schemas are permissive (`additionalProperties: true`) so the
 * daemon may add a field without breaking an older Webview; validation checks required
 * fields, types, and the `type` discriminant — not exhaustiveness.
 */
import { Type as T, type Static, type TSchema } from "@sinclair/typebox";

/** Permissive object: required/typed fields enforced, extra fields allowed (forward-compat). */
function Open<P extends Record<string, TSchema>>(properties: P) {
  return T.Object(properties, { additionalProperties: true });
}

/**
 * An optional field that may also be explicitly `null` on the wire. The daemon has TWO
 * serialization conventions, verified against captured frames: the top-level message
 * fields drop nulls (`@JsonInclude(NON_NULL)` on the DaemonMessage interface), but NESTED
 * records (Artifact, ToolCall, Gate, …) lack that annotation and serialize an absent field
 * as explicit `null`. Modelling optionals as optional-AND-nullable accepts both — and is
 * strictly more permissive, so it can never falsely reject a real frame.
 */
function Opt<S extends TSchema>(schema: S) {
  return T.Optional(T.Union([schema, T.Null()]));
}

// ---- Nested value types (mirror the nested records in DaemonMessage.java) ----

/**
 * A pipeline stage's status (StageStatus in protocol.ts / Java enum). Embedded BY VALUE
 * (not T.Ref) wherever used, so both the in-memory validator and the generated JSON Schema
 * are self-contained — no `$id`/`$ref` resolver needed on any consumer.
 */
export const StageStatus = T.Union([
  T.Literal("pending"),
  T.Literal("running"),
  T.Literal("blocked"),
  T.Literal("done"),
  T.Literal("skipped"),
  T.Literal("failed"),
]);

/** A pipeline stage in the timeline. */
export const StageProgress = Open({
  stageId: T.String(),
  label: T.String(),
  status: StageStatus,
  artifactRefs: T.Array(T.String()),
  detail: Opt(T.String()),
});

/** A reference to an out-of-band Arrow IPC frame (ADR-0002). Fetched separately. */
export const ArrowRef = Open({
  kind: T.Literal("arrow"),
  ref: T.String(),
  rows: Opt(T.Number()),
  cols: Opt(T.Number()),
});

/** A DataViz tool call — a chart spec, NOT a rendered image (ADR-0007). */
export const DataVizSpec = Open({
  type: T.Union([
    T.Literal("bar"),
    T.Literal("line"),
    T.Literal("scatter"),
    T.Literal("boxplot"),
    T.Literal("heatmap"),
  ]),
  title: Opt(T.String()),
  encodings: T.Record(T.String(), T.String()),
  dataRef: ArrowRef,
});

/** Artifact kinds the canvas renders. */
export const ArtifactKind = T.Union([
  T.Literal("report"),
  T.Literal("leaderboard"),
  T.Literal("chart"),
  T.Literal("dataframe"),
  T.Literal("file"),
  T.Literal("image"),
]);

/** A run artifact (report | leaderboard | chart | dataframe | file | image). */
export const Artifact = Open({
  ref: T.String(),
  kind: ArtifactKind,
  title: T.String(),
  // Markdown text or a `data:` URI only (ADR-0011) — never JSON. Structured payloads ride `meta`.
  body: Opt(T.String()),
  viz: Opt(DataVizSpec),
  data: Opt(ArrowRef),
  path: Opt(T.String()),
  // Free-form structured JSON payload (ADR-0011): the single typed channel for structured
  // artifact data (e.g. the `metrics` and `diagnostics` kinds). `T.Any()` keeps the daemon
  // schema-agnostic — it carries whatever JSON the producer emits, validated by the consumer.
  meta: Opt(T.Any()),
});

/** A tool call the agent makes — rendered as a collapsible card (ADR-0006). */
export const ToolCall = Open({
  id: T.String(),
  title: T.String(),
  kind: T.Union([
    T.Literal("skill"),
    T.Literal("script"),
    T.Literal("shell"),
    T.Literal("read"),
    T.Literal("write"),
    T.Literal("dataviz"),
    T.Literal("sql"),
  ]),
  status: T.Union([T.Literal("running"), T.Literal("done"), T.Literal("failed")]),
  code: Opt(T.String()),
  output: Opt(T.String()),
  score: Opt(T.String()),
});

/** A blocking human-in-the-loop question — the Clarify gate (ADR-0010). */
export const Question = Open({
  id: T.String(),
  header: Opt(T.String()),
  prompt: T.String(),
  options: Opt(T.Array(T.String())),
  multiSelect: Opt(T.Boolean()),
});

/** One item in the agent's live task plan (R1). */
export const Todo = Open({
  content: T.String(),
  status: T.String(),
  activeForm: T.String(),
});

/** Tiers of human gate (ADR-0010). */
export const GateKind = T.Union([T.Literal("clarify"), T.Literal("approval"), T.Literal("plan")]);

/** A blocking gate (clarify | approval | plan). */
export const Gate = Open({
  id: T.String(),
  kind: GateKind,
  prompt: T.String(),
  question: Opt(Question),
});

/** One turn in the conversation transcript (ADR-0006). Webview-owned; not a wire message,
 * but part of the shared vocabulary so the app and tests speak one set of types. */
export const ChatTurn = Open({
  id: T.String(),
  role: T.Union([T.Literal("user"), T.Literal("agent")]),
  text: T.String(),
  toolCalls: T.Array(ToolCall),
  status: T.Union([T.Literal("streaming"), T.Literal("done"), T.Literal("failed")]),
});

// ---- The message union (one member per record in DaemonMessage.java) ----

export const SessionStarted = Open({
  type: T.Literal("session-started"),
  sessionId: T.String(),
  greeting: Opt(T.String()),
});

/** Legacy single-run start (mock + scripted source still emit it); treated as session start. */
export const RunStarted = Open({
  type: T.Literal("run-started"),
  runId: T.String(),
  goal: T.String(),
  stages: T.Array(StageProgress),
});

export const TurnStarted = Open({
  type: T.Literal("turn-started"),
  turnId: T.String(),
  role: T.Literal("agent"),
});

export const TurnFinished = Open({
  type: T.Literal("turn-finished"),
  turnId: T.String(),
  status: T.Union([T.Literal("done"), T.Literal("failed")]),
  outputTokens: Opt(T.Number()),
});

export const StageProgressMsg = Open({
  type: T.Literal("stage-progress"),
  runId: T.String(),
  stage: StageProgress,
});

export const AgentChunk = Open({
  type: T.Literal("agent-chunk"),
  runId: T.String(),
  text: T.String(),
});

export const ToolCallMsg = Open({
  type: T.Literal("tool-call"),
  runId: T.String(),
  call: ToolCall,
});

export const TodoListMsg = Open({
  type: T.Literal("todo-list"),
  runId: T.String(),
  todos: T.Array(Todo),
});

export const ArtifactMsg = Open({
  type: T.Literal("artifact"),
  runId: T.String(),
  artifact: Artifact,
});

export const GateOpened = Open({
  type: T.Literal("gate-opened"),
  runId: T.String(),
  gate: Gate,
});

export const GateClosed = Open({
  type: T.Literal("gate-closed"),
  runId: T.String(),
  gateId: T.String(),
});

export const RunFinished = Open({
  type: T.Literal("run-finished"),
  runId: T.String(),
  status: T.Union([T.Literal("completed"), T.Literal("failed"), T.Literal("cancelled")]),
});

/**
 * Discriminated union of everything the daemon streams (ADR-0006). `$id` lets the
 * generated JSON Schema be referenced by name; the `type` field is the discriminant.
 */
export const DaemonMessage = T.Union(
  [
    SessionStarted,
    RunStarted,
    TurnStarted,
    TurnFinished,
    StageProgressMsg,
    AgentChunk,
    ToolCallMsg,
    TodoListMsg,
    ArtifactMsg,
    GateOpened,
    GateClosed,
    RunFinished,
  ],
  { $id: "DaemonMessage" },
);

/** Replies the Webview sends back over the WebSocket (WebviewReply in protocol.ts). */
export const WebviewReply = T.Union(
  [
    Open({ type: T.Literal("user-message"), text: T.String() }),
    Open({ type: T.Literal("answer"), gateId: T.String(), answer: T.String() }),
    Open({ type: T.Literal("approve"), gateId: T.String() }),
    Open({ type: T.Literal("reject"), gateId: T.String() }),
    Open({ type: T.Literal("cancel-run") }),
  ],
  { $id: "WebviewReply" },
);

// ---- Inferred TS types (consumed by app/src/daemon/protocol.ts) ----

export type StageStatus = Static<typeof StageStatus>;
export type StageProgress = Static<typeof StageProgress>;
export type ArrowRef = Static<typeof ArrowRef>;
export type DataVizSpec = Static<typeof DataVizSpec>;
export type ArtifactKind = Static<typeof ArtifactKind>;
export type Artifact = Static<typeof Artifact>;
export type ToolCall = Static<typeof ToolCall>;
export type Question = Static<typeof Question>;
export type Todo = Static<typeof Todo>;
export type GateKind = Static<typeof GateKind>;
export type Gate = Static<typeof Gate>;
export type ChatTurn = Static<typeof ChatTurn>;
export type DaemonMessage = Static<typeof DaemonMessage>;
export type WebviewReply = Static<typeof WebviewReply>;
