/**
 * UAT — Auto-follow pipeline navigation (ADR-0017) through the REAL Workspace chrome + store.
 * A scripted run seeds a pending timeline, then streams stage-progress + artifacts. As each
 * stage's artifacts arrive, the cockpit must switch to the Pipeline view and SELECT that
 * stage (the `.stage.selected` class). A manual stage click then latches: a later stage's
 * arrival must NOT yank the selection. On finish, it rests on the final report stage.
 *
 * ECharts is globally stubbed in test/setup.ts (jsdom has no canvas), so a streamed report
 * with a numeric table won't blow up the run.
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { test, expect } from "vitest";
import { RunProvider } from "../store/RunContext";
import { WorkspaceInner } from "../ui/Workspace";
import { MockRunPlayer } from "../daemon/mock/player";
import type { connectRun } from "../daemon/connect";
import type { DaemonMessage, StageProgress } from "../daemon/protocol";

function connectWith(script: DaemonMessage[]): typeof connectRun {
  const connect = async () => ({ connection: new MockRunPlayer(script, { stepMs: 1 }), mode: "daemon" as const });
  return connect as unknown as typeof connectRun;
}

// The daemon seeds the whole timeline as pending up front (run-started.stages).
const seed: StageProgress[] = [
  { stageId: "eda", label: "Exploratory Data Analysis", status: "pending", artifactRefs: [] },
  { stageId: "features", label: "Feature Engineering", status: "pending", artifactRefs: [] },
  { stageId: "candidates", label: "Candidate Evaluation", status: "pending", artifactRefs: [] },
  { stageId: "report", label: "Report", status: "pending", artifactRefs: [] },
];

const stageDone = (stageId: string, label: string): DaemonMessage =>
  ({ type: "stage-progress", runId: "r", stage: { stageId, label, status: "done", artifactRefs: [stageId] } } as DaemonMessage);
const artifact = (ref: string, kind: string, title: string, body?: string): DaemonMessage =>
  ({ type: "artifact", runId: "r", artifact: { ref, kind, title, body } } as DaemonMessage);

/** The currently-selected stage label in the Timeline, or null. */
function selectedStageLabel(): string | null {
  const sel = document.querySelector(".timeline .stage.selected .label");
  return sel?.textContent ?? null;
}

test("auto-follows each stage as its artifacts arrive, switching to the Pipeline view", async () => {
  const script: DaemonMessage[] = [
    { type: "run-started", runId: "r", goal: "AutoML", stages: seed } as DaemonMessage,
    stageDone("eda", "Exploratory Data Analysis"),
    artifact("eda", "report", "EDA", "# EDA\n\nLooks fine."),
    stageDone("features", "Feature Engineering"),
    artifact("features", "dataframe", "Features"),
    { type: "run-finished", runId: "r", status: "completed" } as DaemonMessage,
  ];
  render(<RunProvider connect={connectWith(script)}><WorkspaceInner /></RunProvider>);

  // Kick the scripted run by sending a user turn (the mock waits for the first message).
  await waitFor(() => expect(screen.getByPlaceholderText(/Message Clair/i)).toBeInTheDocument());
  const box = screen.getByPlaceholderText(/Message Clair/i);
  fireEvent.change(box, { target: { value: "Run AutoML" } });
  fireEvent.keyDown(box, { key: "Enter" });

  // The Pipeline view appears and follows: it ends up selecting the latest stage that
  // produced artifacts. With both eda + features landed and the run finished on a non-report
  // final stage, it rests on the latest stage-with-artifacts → Feature Engineering.
  await waitFor(() => expect(document.querySelector(".timeline")).toBeInTheDocument());
  await waitFor(() => expect(selectedStageLabel()).toBe("Feature Engineering"));
});

test("rests on the final Report stage when the run finishes", async () => {
  const script: DaemonMessage[] = [
    { type: "run-started", runId: "r", goal: "AutoML", stages: seed } as DaemonMessage,
    stageDone("eda", "Exploratory Data Analysis"),
    artifact("eda", "report", "EDA", "# EDA"),
    stageDone("candidates", "Candidate Evaluation"),
    artifact("candidates", "leaderboard", "Leaderboard", "| Model | AUC |\n|---|---|\n| RF | 0.88 |"),
    stageDone("report", "Report"),
    artifact("report", "report", "AutoML Report", "# Report\n\nDone."),
    { type: "run-finished", runId: "r", status: "completed" } as DaemonMessage,
  ];
  render(<RunProvider connect={connectWith(script)}><WorkspaceInner /></RunProvider>);

  await waitFor(() => expect(screen.getByPlaceholderText(/Message Clair/i)).toBeInTheDocument());
  const box = screen.getByPlaceholderText(/Message Clair/i);
  fireEvent.change(box, { target: { value: "Run AutoML" } });
  fireEvent.keyDown(box, { key: "Enter" });

  // Even though candidates(leaderboard) and report both landed, on finish it rests on the
  // FINAL report stage — not the leaderboard view, not the latest non-report stage.
  await waitFor(() => expect(selectedStageLabel()).toBe("Report"));
  // And it's the STABLE final state, not a transient: the Pipeline view owns the canvas
  // (the leaderboard auto-jump is superseded), and the Leaderboard rail button is not active.
  expect(document.querySelector(".canvas-pipeline")).toBeInTheDocument();
  const leaderboardBtn = screen.getByRole("button", { name: /Leaderboard/i });
  expect(leaderboardBtn.className).not.toMatch(/\bactive\b/);
  // Selection still rests on Report after settling (re-assert post-finish).
  expect(selectedStageLabel()).toBe("Report");
});

test("re-arms on a NEW run: a fresh run restores auto-follow after the user took control", async () => {
  // Run 1 finishes resting on Report; user clicks EDA (latches). A SECOND run then starts and
  // streams a new stage — auto-follow must re-arm and follow it, NOT stay stuck on EDA.
  const script: DaemonMessage[] = [
    // ── run 1 ──
    { type: "run-started", runId: "r1", goal: "AutoML", stages: seed } as DaemonMessage,
    stageDone("eda", "Exploratory Data Analysis"),
    artifact("eda", "report", "EDA", "# EDA"),
    stageDone("report", "Report"),
    artifact("report", "report", "AutoML Report", "# Report"),
    { type: "run-finished", runId: "r1", status: "completed" } as DaemonMessage,
    // ── a gate gives us a pause point AFTER run 2 starts but before its stage lands ──
    { type: "run-started", runId: "r2", goal: "AutoML again", stages: seed } as DaemonMessage,
    { type: "gate-opened", runId: "r2", gate: { id: "g2", kind: "approval", prompt: "Proceed?" } } as DaemonMessage,
    { type: "gate-closed", runId: "r2", gateId: "g2" } as DaemonMessage,
    stageDone("candidates", "Candidate Evaluation"),
    artifact("candidates", "leaderboard", "Leaderboard", "| Model | AUC |\n|---|---|\n| RF | 0.88 |"),
    { type: "run-finished", runId: "r2", status: "completed" } as DaemonMessage,
  ];
  render(<RunProvider connect={connectWith(script)}><WorkspaceInner /></RunProvider>);

  await waitFor(() => expect(screen.getByPlaceholderText(/Message Clair/i)).toBeInTheDocument());
  const box = screen.getByPlaceholderText(/Message Clair/i);
  fireEvent.change(box, { target: { value: "Run AutoML" } });
  fireEvent.keyDown(box, { key: "Enter" });

  // Run 1 rests on Report; user manually clicks EDA (takes control).
  await waitFor(() => expect(selectedStageLabel()).toBe("Report"));
  const timeline = document.querySelector(".timeline") as HTMLElement;
  fireEvent.click(within(timeline).getByText("Exploratory Data Analysis"));
  await waitFor(() => expect(selectedStageLabel()).toBe("Exploratory Data Analysis"));

  // Run 2 starts (re-arm), pauses at its gate; approve to let its stage stream in.
  const approve = await screen.findByRole("button", { name: /Approve & continue/i });
  fireEvent.click(approve);

  // Auto-follow re-armed: it follows run 2's Candidate Evaluation, NOT the latched EDA.
  await waitFor(() => expect(selectedStageLabel()).toBe("Candidate Evaluation"));
}, 10000);

test("a manual stage click latches: a later stage's arrival does not yank the selection", async () => {
  // A gate pauses the script mid-stream so we can click before later stages arrive.
  const script: DaemonMessage[] = [
    { type: "run-started", runId: "r", goal: "AutoML", stages: seed } as DaemonMessage,
    stageDone("eda", "Exploratory Data Analysis"),
    artifact("eda", "report", "EDA", "# EDA"),
    { type: "gate-opened", runId: "r", gate: { id: "g1", kind: "approval", prompt: "Proceed?" } } as DaemonMessage,
    // (paused here until approved)
    { type: "gate-closed", runId: "r", gateId: "g1" } as DaemonMessage,
    stageDone("features", "Feature Engineering"),
    artifact("features", "dataframe", "Features"),
    { type: "run-finished", runId: "r", status: "completed" } as DaemonMessage,
  ];
  render(<RunProvider connect={connectWith(script)}><WorkspaceInner /></RunProvider>);

  await waitFor(() => expect(screen.getByPlaceholderText(/Message Clair/i)).toBeInTheDocument());
  const box = screen.getByPlaceholderText(/Message Clair/i);
  fireEvent.change(box, { target: { value: "Run AutoML" } });
  fireEvent.keyDown(box, { key: "Enter" });

  // Auto-follow selects EDA when its artifact lands, then the script pauses at the gate.
  await waitFor(() => expect(selectedStageLabel()).toBe("Exploratory Data Analysis"));

  // The user manually clicks the (pending) Candidate Evaluation stage — taking control.
  const timeline = document.querySelector(".timeline") as HTMLElement;
  const candidatesStage = within(timeline).getByText("Candidate Evaluation");
  fireEvent.click(candidatesStage);
  await waitFor(() => expect(selectedStageLabel()).toBe("Candidate Evaluation"));

  // Approve the gate → the run resumes and Feature Engineering's artifact arrives. Because
  // the user took control, auto-follow must NOT yank to Feature Engineering.
  const approve = await screen.findByRole("button", { name: /Approve & continue/i });
  fireEvent.click(approve);

  // Give the resumed stream time to deliver the features artifact + run-finished.
  await waitFor(() => expect(screen.getByText("Feature Engineering")).toBeInTheDocument());
  // Selection stays on the user's manual choice — never pulled to the new stage.
  expect(selectedStageLabel()).toBe("Candidate Evaluation");
}, 10000);

test("a mid-run chat reply does NOT re-arm: the user's manual selection is preserved", async () => {
  // The user clicks a stage, then sends a chat message WHILE the same run is still going.
  // status stays 'running' across a chat turn (only run-finished clears it), so this must
  // NOT count as a new run — the manual selection must survive a later stage arriving.
  const script: DaemonMessage[] = [
    { type: "run-started", runId: "r", goal: "AutoML", stages: seed } as DaemonMessage,
    stageDone("eda", "Exploratory Data Analysis"),
    artifact("eda", "report", "EDA", "# EDA"),
    { type: "gate-opened", runId: "r", gate: { id: "g", kind: "approval", prompt: "Proceed?" } } as DaemonMessage,
    { type: "gate-closed", runId: "r", gateId: "g" } as DaemonMessage,
    stageDone("features", "Feature Engineering"),
    artifact("features", "dataframe", "Features"),
    { type: "run-finished", runId: "r", status: "completed" } as DaemonMessage,
  ];
  render(<RunProvider connect={connectWith(script)}><WorkspaceInner /></RunProvider>);

  await waitFor(() => expect(screen.getByPlaceholderText(/Message Clair/i)).toBeInTheDocument());
  const box = screen.getByPlaceholderText(/Message Clair/i);
  fireEvent.change(box, { target: { value: "Run AutoML" } });
  fireEvent.keyDown(box, { key: "Enter" });

  // Auto-follow selects EDA; user manually clicks the pending Report stage (takes control).
  await waitFor(() => expect(selectedStageLabel()).toBe("Exploratory Data Analysis"));
  const timeline = document.querySelector(".timeline") as HTMLElement;
  fireEvent.click(within(timeline).getByText("Report"));
  await waitFor(() => expect(selectedStageLabel()).toBe("Report"));

  // The user sends a clarifying chat message mid-run (status stays 'running').
  fireEvent.change(box, { target: { value: "why did you skip resampling?" } });
  fireEvent.keyDown(box, { key: "Enter" });
  // Approve the gate so Feature Engineering streams in afterward.
  const approve = await screen.findByRole("button", { name: /Approve & continue/i });
  fireEvent.click(approve);
  await waitFor(() => expect(screen.getByText("Feature Engineering")).toBeInTheDocument());

  // The mid-run reply did NOT re-arm: selection stays on the user's manual Report choice.
  expect(selectedStageLabel()).toBe("Report");
}, 10000);
