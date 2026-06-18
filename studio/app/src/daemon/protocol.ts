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
  kind: "skill" | "script" | "shell" | "read" | "write" | "dataviz";
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
  prompt: string;
  /** When present, render as choices; otherwise a free-text answer. */
  options?: string[];
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

/** Discriminated union of everything the daemon streams for a Run. */
export type DaemonMessage =
  | { type: "run-started"; runId: string; goal: string; stages: StageProgress[] }
  | { type: "stage-progress"; runId: string; stage: StageProgress }
  | { type: "agent-chunk"; runId: string; text: string }
  | { type: "tool-call"; runId: string; call: ToolCall }
  | { type: "artifact"; runId: string; artifact: Artifact }
  | { type: "gate-opened"; runId: string; gate: Gate }
  | { type: "gate-closed"; runId: string; gateId: string }
  | { type: "run-finished"; runId: string; status: "completed" | "failed" | "cancelled" };

/** Replies the Webview sends back (relayed via the Shell for control actions). */
export type WebviewReply =
  | { type: "answer"; runId: string; questionId: string; answer: string }
  | { type: "approve"; runId: string; gateId: string }
  | { type: "reject"; runId: string; gateId: string }
  | { type: "cancel-run"; runId: string };
