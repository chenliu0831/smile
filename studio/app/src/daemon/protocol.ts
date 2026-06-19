/**
 * The typed contract between the Smile Daemon and the Webview (ADR-0002, ADR-0006).
 *
 * Both the mock daemon (V0) and the real JVM daemon (evolved `serve/`) emit these
 * messages. Control/lifecycle goes Webview -> Shell -> Daemon; high-throughput
 * streams (everything below) flow Webview <-> Daemon directly over WebSocket, with
 * bulk columnar data carried as Arrow frames referenced by `ArrowRef`.
 *
 * Naming follows CONTEXT.md: AutoML Run, Candidate, Run Artifacts, DataViz call, Gate.
 */

/** The skill's pipeline stages (analyst/skills/automl/SKILL.md, steps 0–11). */
export type StageStatus = "pending" | "running" | "blocked" | "done" | "skipped" | "failed";

export interface StageProgress {
  /** Stable id, e.g. "eda", "preprocess", "candidate-eval". */
  stageId: string;
  /** Human label for the timeline, e.g. "Exploratory Data Analysis". */
  label: string;
  status: StageStatus;
  /** Refs to artifacts this stage produced (resolved via ArtifactMsg). */
  artifactRefs: string[];
  /** Optional short detail, e.g. "5 candidates evaluated". */
  detail?: string;
}

/** A reference to an out-of-band Arrow IPC frame (ADR-0002). Fetched separately. */
export interface ArrowRef {
  kind: "arrow";
  /** Opaque id the daemon resolves to an Arrow IPC byte stream. */
  ref: string;
  /** Row/col hints for the grid before the bytes arrive. */
  rows?: number;
  cols?: number;
}

/** A DataViz tool call — a chart spec, NOT a rendered image (ADR-0007). */
export interface DataVizSpec {
  type: "bar" | "line" | "scatter" | "boxplot" | "heatmap";
  title?: string;
  /** Encodings keyed by channel, e.g. { x: "fpr", y: "tpr" }. */
  encodings: Record<string, string>;
  /** Where the chart's data lives (Arrow frame). */
  dataRef: ArrowRef;
}

export type ArtifactKind = "report" | "leaderboard" | "chart" | "dataframe" | "file";

export interface Artifact {
  /** Stable ref used by StageProgress.artifactRefs. */
  ref: string;
  kind: ArtifactKind;
  /** Display title, e.g. "EDA Report", "Leaderboard". */
  title: string;
  /** For report/file: markdown or text body. */
  body?: string;
  /** For chart: the DataViz spec to render. */
  viz?: DataVizSpec;
  /** For dataframe/leaderboard: the backing tabular data. */
  data?: ArrowRef;
  /** Working-directory path, when the artifact is a real file. */
  path?: string;
}

/** A tool call the agent makes — rendered as a collapsible card (ADR-0006). */
export interface ToolCall {
  id: string;
  /** Collapsed-card title, e.g. "Ran candidate_lgbm.py". */
  title: string;
  /** Coarse kind drives the icon/affordance. */
  kind: "skill" | "script" | "shell" | "read" | "write" | "dataviz" | "sql";
  status: "running" | "done" | "failed";
  /** Expanded view: the code/command executed. */
  code?: string;
  /** Expanded view: captured output. */
  output?: string;
  /** Headline result shown on the collapsed card, e.g. "AUC 0.91". */
  score?: string;
}

/** A blocking human-in-the-loop question — the Clarify gate (ADR-0010). */
export interface Question {
  id: string;
  /** Short label for the question (e.g. "Primary metric"); the agent's Question.header. */
  header?: string;
  prompt: string;
  /** When present, render as choices; otherwise a free-text answer. */
  options?: string[];
  /** When true, the user may pick multiple options (checkbox set + Submit). */
  multiSelect?: boolean;
}

/** One item in the agent's live task plan (R1). */
export interface Todo {
  content: string;
  /** "pending" | "in_progress" | "completed" (agent-defined). */
  status: string;
  /** Present-continuous form shown while in progress, e.g. "Training models". */
  activeForm: string;
}

/** Tiers of human gate (ADR-0010). */
export type GateKind = "clarify" | "approval" | "plan";

export interface Gate {
  id: string;
  kind: GateKind;
  /** What the run is waiting to do, e.g. "Start AutoML Run", "Run GPU NAS". */
  prompt: string;
  /** For clarify gates, the underlying question. */
  question?: Question;
}

/** One turn in the conversation transcript (ADR-0006, interactive chat). */
export interface ChatTurn {
  id: string;
  role: "user" | "agent";
  /** Accumulated text — the user's prompt, or the agent's streamed response. */
  text: string;
  /** Agent turns: the tool calls made while producing this turn. */
  toolCalls: ToolCall[];
  status: "streaming" | "done" | "failed";
}

/**
 * Discriminated union of everything the daemon streams. The session is a multi-turn
 * conversation (ADR-0006): `session-started` once, then per user turn the daemon emits
 * `turn-started` (agent), then a stream of `agent-chunk` / `tool-call` / `gate-opened`,
 * then `turn-finished`. Stages and artifacts accumulate at the session level.
 */
export type DaemonMessage =
  | { type: "session-started"; sessionId: string; greeting?: string }
  // Legacy single-run start (mock + scripted source still emit it); treated as session start.
  | { type: "run-started"; runId: string; goal: string; stages: StageProgress[] }
  | { type: "turn-started"; turnId: string; role: "agent" }
  | { type: "turn-finished"; turnId: string; status: "done" | "failed"; outputTokens?: number }
  | { type: "stage-progress"; runId: string; stage: StageProgress }
  | { type: "agent-chunk"; runId: string; text: string }
  | { type: "tool-call"; runId: string; call: ToolCall }
  | { type: "todo-list"; runId: string; todos: Todo[] }
  | { type: "artifact"; runId: string; artifact: Artifact }
  | { type: "gate-opened"; runId: string; gate: Gate }
  | { type: "gate-closed"; runId: string; gateId: string }
  | { type: "run-finished"; runId: string; status: "completed" | "failed" | "cancelled" };

/** Replies the Webview sends back over the WebSocket. */
export type WebviewReply =
  // A free-text user turn — starts the session's first turn or continues the chat.
  | { type: "user-message"; text: string }
  // A clarify-gate answer carrying the user's free text (or chosen option).
  | { type: "answer"; gateId: string; answer: string }
  | { type: "approve"; gateId: string }
  | { type: "reject"; gateId: string }
  | { type: "cancel-run" };
