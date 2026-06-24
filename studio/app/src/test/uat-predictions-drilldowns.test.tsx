/**
 * UAT — Predictions Studio drill-downs (S3, ADR-0011). Builds on S2: a `dataframe` prediction
 * artifact streams in; clicking a confusion cell lists its rows, and clicking a row expands
 * its features — all client-side over the rows fetched once. ECharts is stubbed so the
 * confusion chart's onEvents.click can be fired in jsdom (which has no canvas).
 */
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { vi, beforeEach, afterEach, test, expect } from "vitest";
import { RunProvider, useRunContext } from "../store/RunContext";
import { Canvas } from "../ui/Canvas";
import { useStore } from "zustand";
import { MockRunPlayer } from "../daemon/mock/player";
import type { connectRun } from "../daemon/connect";
import type { DaemonMessage } from "../daemon/protocol";

// Stub ECharts. The FIRST instance is the confusion heatmap; expose a button that fires its
// onEvents.click with the "true positive" cell coordinate [x=1 (pred 1), y=0 (act 1)].
vi.mock("echarts-for-react", () => ({
  default: ({ onEvents }: { onEvents?: { click?: (p: { data: number[] }) => void } }) =>
    onEvents?.click
      ? <button data-testid="confusion-cell-tp" onClick={() => onEvents.click!({ data: [1, 0] })}>cell</button>
      : <div data-testid="echarts" />,
}));

const HTTP_BASE = "http://127.0.0.1:0/api/v1";

const SCRIPT: DaemonMessage[] = [
  {
    type: "artifact", runId: "r",
    artifact: { ref: "submission", kind: "dataframe", title: "Predictions", data: { kind: "arrow", ref: "submission" } },
  } as DaemonMessage,
  { type: "run-finished", runId: "r", status: "completed" } as DaemonMessage,
];

function scriptConnect(): typeof connectRun {
  const connect = async () => {
    const player = new MockRunPlayer(SCRIPT, { stepMs: 1 });
    (player as unknown as { httpBase: () => string | null }).httpBase = () => HTTP_BASE;
    return { connection: player, mode: "daemon" as const };
  };
  return connect as unknown as typeof connectRun;
}

function Harness() {
  const { store, sendMessage } = useRunContext();
  const session = useStore(store, (s) => s.session);
  return (
    <>
      <button onClick={() => sendMessage("go")}>go</button>
      <span data-testid="status">{session.status}</span>
      <Canvas artifacts={Object.values(session.artifacts)} />
    </>
  );
}

beforeEach(() => {
  const table = {
    PassengerId: [1, 2, 3, 4, 5, 6],
    Age: [22, 38, 26, 35, 54, 2],
    Survived_proba: [0.9, 0.8, 0.6, 0.4, 0.2, 0.1],
    Survived_actual: [1, 1, 0, 1, 0, 0],
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    String(url).includes("/data/submission")
      ? new Response(JSON.stringify(table), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("{}", { status: 404 }),
  ));
});

afterEach(() => vi.unstubAllGlobals());

test("clicking a confusion cell lists its rows; clicking a row expands its features", async () => {
  render(<RunProvider connect={scriptConnect()}><Harness /></RunProvider>);
  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("running"));
  fireEvent.click(screen.getByText("go"));

  // The confusion chart (first ECharts instance) renders.
  await waitFor(() => expect(screen.getByTestId("confusion-cell-tp")).toBeInTheDocument());

  // Click the true-positive cell → at threshold 0.50, TPs are PassengerId 1 (0.9) and 2 (0.8).
  await act(async () => { fireEvent.click(screen.getByTestId("confusion-cell-tp")); });
  await waitFor(() => expect(screen.getByTestId("predictions-drill")).toBeInTheDocument());
  expect(screen.getByText(/2 true positives/)).toBeInTheDocument();
  expect(screen.getByText(/row 0 · proba 0\.900 · actual 1/)).toBeInTheDocument();

  // Click a row → its features (Age, PassengerId) expand inline.
  fireEvent.click(screen.getByText(/row 0 · proba 0\.900/));
  await waitFor(() => expect(screen.getByTestId("predictions-features")).toBeInTheDocument());
  expect(screen.getByText("Age")).toBeInTheDocument();
  expect(screen.getByText("22")).toBeInTheDocument();
});
