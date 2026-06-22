/**
 * UAT — the CLARIFY gate flow through the REAL React UI + store, replaying a gate-bearing
 * /ws/run transcript via an injected fixtureConnect. This closes the hole that let a
 * gate-hang bug ship: ws-summarize.jsonl has ZERO gate frames, so nothing exercised the
 * human-in-the-loop pause/resume path end to end.
 *
 * What it proves:
 *  1. A daemon `gate-opened` (clarify, WITH options — the real wire shape, field named
 *     `options`, NOT `choices`) renders as an answerable prompt with one button per choice.
 *  2. Clicking a choice routes the answer back: resolveGate → answerGate → the player's
 *     resume(gateId), which un-pauses the scripted run.
 *  3. The gate closes (`gate-closed` removes it from openGates) AND the post-gate frames
 *     stream (acknowledgement + leaderboard artifact), proving the answer unblocked the run
 *     to completion (turn-finished re-enables the chat input).
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { RunProvider } from "../store/RunContext";
import { RunZones } from "../ui/RunView";
import { fixtureConnect } from "./harness";

// Replay with a small per-frame delay so the React effect + timers drain naturally, and the
// gate UI mounts mid-stream before the test acts on it (mirrors uat-summarize-ui).
const connect = fixtureConnect({ file: "ws-gate.jsonl", player: { stepMs: 1 } });

test("answering a clarify gate routes the choice back and continues the run to completion", async () => {
  render(
    <RunProvider connect={connect}>
      <RunZones />
    </RunProvider>,
  );
  // greeting from the captured session-started
  await waitFor(() => expect(screen.getByPlaceholderText(/Message Clair/i)).toBeInTheDocument());

  const box = screen.getByPlaceholderText(/Message Clair/i);
  fireEvent.change(box, { target: { value: "Run AutoML on the titanic dataset" } });
  fireEvent.keyDown(box, { key: "Enter" });

  // the user turn renders
  await waitFor(() => expect(screen.getByText("Run AutoML on the titanic dataset")).toBeInTheDocument());

  // (1) the gate renders as an answerable prompt — the question text + a button per choice.
  await waitFor(() =>
    expect(screen.getByText("What kind of model should I build for this dataset?")).toBeInTheDocument(),
  );
  const binaryBtn = await screen.findByRole("button", { name: "Binary Classification" });
  expect(screen.getByRole("button", { name: "Multiclass Classification" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Regression" })).toBeInTheDocument();

  // (2) click the recommended choice — routes the answer back through resolveGate.
  fireEvent.click(binaryBtn);

  // (3a) the gate disappears: gate-closed removed it from openGates, so its choice buttons
  // are gone (the prompt no longer renders).
  await waitFor(() =>
    expect(screen.queryByText("What kind of model should I build for this dataset?")).not.toBeInTheDocument(),
  );

  // (3b) a post-gate frame renders — the leaderboard artifact + acknowledgement prose — proving
  // the answer un-paused the scripted run. Content spans many DOM nodes (markdown table), so
  // assert on the whole rendered document text.
  await waitFor(
    () =>
      expect(document.body.textContent || "").toMatch(
        /binary classifier|Model Leaderboard|GradientBoosting|0\.86 AUC/,
      ),
    { timeout: 5000 },
  );

  // and the chat returns to a ready state (not stuck streaming) — turn-finished cleared it.
  await waitFor(() => {
    const ready = screen.getByPlaceholderText(/Message Clair/i) as HTMLTextAreaElement;
    expect(ready.disabled).toBe(false);
  });
}, 10000);
