/**
 * UAT — Close the Loop (S8, ADR-0006). The report's "Recommended Next Steps" render as
 * one-click steering buttons that fire a templated `user-message` turn carrying the run's
 * baseline metric. Driven through the real store so the metrics-artifact baseline is woven in.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { vi, test, expect } from "vitest";
import { RunProvider, useRunContext } from "../store/RunContext";
import { Canvas } from "../ui/Canvas";
import { SchemaRail } from "../ui/SqlConsole";
import { useStore } from "zustand";
import { MockRunPlayer } from "../daemon/mock/player";
import type { connectRun } from "../daemon/connect";
import type { DaemonMessage } from "../daemon/protocol";

const REPORT = `# AutoML Report
## Final Performance
Test AUC 0.921.
## Recommended Next Steps
1. Add CatBoost as a 4th learner.
2. Switch Platt → isotonic calibration.
`;

const SCRIPT: DaemonMessage[] = [
  metricsArtifact(),
  { type: "artifact", runId: "r", artifact: { ref: "report", kind: "report", title: "AutoML Report", body: REPORT } } as DaemonMessage,
  { type: "run-finished", runId: "r", status: "completed" } as DaemonMessage,
];

function metricsArtifact(): DaemonMessage {
  return { type: "artifact", runId: "r", artifact: { ref: "metrics", kind: "metrics", title: "Run Scorecard", meta: { primary_metric: "AUC", test_auc: 0.921 } } } as DaemonMessage;
}

const sent: string[] = [];
function connectSpy(): typeof connectRun {
  const connect = async () => {
    const player = new MockRunPlayer(SCRIPT, { stepMs: 1 });
    const real = player.sendMessage.bind(player);
    player.sendMessage = (t: string) => { sent.push(t); real(t); };
    return { connection: player, mode: "daemon" as const };
  };
  return connect as unknown as typeof connectRun;
}

function Harness() {
  const { store, sendMessage } = useRunContext();
  const session = useStore(store, (s) => s.session);
  // Render the report artifact through the real Canvas dispatch.
  const report = Object.values(session.artifacts).find((a) => a.kind === "report");
  return (
    <>
      <button onClick={() => sendMessage("go")}>go</button>
      <span data-testid="status">{session.status}</span>
      {report && <Canvas artifacts={[report]} />}
    </>
  );
}

test("report Next Steps become buttons that send a templated steering turn with the baseline", async () => {
  sent.length = 0;
  render(<RunProvider connect={connectSpy()}><Harness /></RunProvider>);
  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("running"));
  fireEvent.click(screen.getByText("go"));

  await waitFor(() => expect(screen.getByTestId("next-steps")).toBeInTheDocument());
  // Both parsed steps render as buttons.
  expect(screen.getByRole("button", { name: /Add CatBoost as a 4th learner/ })).toBeInTheDocument();
  const isoBtn = screen.getByRole("button", { name: /Switch Platt/ });

  // Clicking sends a templated turn carrying the step text AND the baseline metric.
  fireEvent.click(isoBtn);
  await waitFor(() => expect(sent.some((m) => /Switch Platt/.test(m))).toBe(true));
  const msg = sent.find((m) => /Switch Platt/.test(m))!;
  // The baseline is the Scorecard's top headline score (test_auc → "TEST 0.921").
  expect(msg).toMatch(/baseline is TEST 0\.921/);
  expect(msg).toMatch(/recommended next step/i);
});

test("schema-rail column 'Ask Clair' affordance fires onAskColumn with name + dtype", () => {
  const onAskColumn = vi.fn();
  render(
    <SchemaRail
      tables={[{ name: "titanic", definition: null, columns: [{ name: "Age", type: "DOUBLE" }] }]}
      history={[]}
      onInsert={() => {}}
      onRestore={() => {}}
      onAskColumn={onAskColumn}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Ask Clair about Age/ }));
  expect(onAskColumn).toHaveBeenCalledWith("titanic", "Age", "DOUBLE");
});
