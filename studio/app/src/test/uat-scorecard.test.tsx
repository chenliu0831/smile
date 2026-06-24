/**
 * UAT — the Scorecard (S5, ADR-0011) through the REAL store + chrome. A transcript carries a
 * `metrics` artifact whose `meta` holds final_metrics.json inline; the persistent strip
 * renders the run framing + headline scores, and hides when no metrics artifact is present.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { test, expect } from "vitest";
import { RunProvider, useRunContext } from "../store/RunContext";
import { Scorecard } from "../ui/Scorecard";
import { useStore } from "zustand";
import { MockRunPlayer } from "../daemon/mock/player";
import type { connectRun } from "../daemon/connect";
import type { DaemonMessage } from "../daemon/protocol";

function connectWith(script: DaemonMessage[]): typeof connectRun {
  const connect = async () => ({ connection: new MockRunPlayer(script, { stepMs: 1 }), mode: "daemon" as const });
  return connect as unknown as typeof connectRun;
}

function Harness() {
  const { store, sendMessage } = useRunContext();
  const status = useStore(store, (s) => s.session.status);
  return (
    <>
      <button onClick={() => sendMessage("go")}>go</button>
      <span data-testid="status">{status}</span>
      <Scorecard />
    </>
  );
}

const metricsArtifact = (meta: unknown): DaemonMessage =>
  ({ type: "artifact", runId: "r", artifact: { ref: "metrics", kind: "metrics", title: "Run Scorecard", meta } } as DaemonMessage);

test("renders the run framing and headline scores from the metrics artifact", async () => {
  const script: DaemonMessage[] = [
    metricsArtifact({
      task_type: "binary_classification", primary_metric: "AUC", cv: "5-fold", rows: 891,
      oof_auc: 0.895, test_auc: 0.860, test_acc: 0.827, ensemble_method: "weighted_average",
    }),
    { type: "run-finished", runId: "r", status: "completed" } as DaemonMessage,
  ];
  render(<RunProvider connect={connectWith(script)}><Harness /></RunProvider>);
  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("running"));
  fireEvent.click(screen.getByText("go"));

  await waitFor(() => expect(screen.getByTestId("scorecard")).toBeInTheDocument());
  // framing: problem type · metric · cv · rows, all present
  expect(screen.getByText(/binary · AUC · 5-fold · 891 rows/)).toBeInTheDocument();
  // headline scores fill in
  expect(screen.getByText("OOF")).toBeInTheDocument();
  expect(screen.getByText("0.895")).toBeInTheDocument();
  expect(screen.getByText("0.860")).toBeInTheDocument();
  expect(screen.getByText(/weighted_average/)).toBeInTheDocument();
});

test("hides entirely when no metrics artifact is present (graceful absence)", async () => {
  const script: DaemonMessage[] = [{ type: "run-finished", runId: "r", status: "completed" } as DaemonMessage];
  render(<RunProvider connect={connectWith(script)}><Harness /></RunProvider>);
  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("running"));
  fireEvent.click(screen.getByText("go"));
  // No scorecard ever appears.
  expect(screen.queryByTestId("scorecard")).toBeNull();
});
