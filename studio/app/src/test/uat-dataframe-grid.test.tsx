/**
 * UAT — a non-prediction CSV dataframe renders as a data grid + source path, with NO
 * Predictions Studio above it (that only appears for labelled prediction sets). Verifies the
 * "always show the data as a table, with its path" surface and the single-fetch composition.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { vi, beforeEach, afterEach, test, expect } from "vitest";
import { RunProvider, useRunContext } from "../store/RunContext";
import { Canvas } from "../ui/Canvas";
import { useStore } from "zustand";
import { MockRunPlayer } from "../daemon/mock/player";
import type { connectRun } from "../daemon/connect";
import type { DaemonMessage } from "../daemon/protocol";

vi.mock("echarts-for-react", () => ({ default: () => <div data-testid="echarts" /> }));

const HTTP_BASE = "http://127.0.0.1:0/api/v1";

// A feature-importance CSV (NOT a prediction set — no proba/truth pair).
const SCRIPT: DaemonMessage[] = [
  {
    type: "artifact", runId: "r",
    artifact: {
      ref: "df:feature_importance", kind: "dataframe", title: "Feature Importance",
      data: { kind: "arrow", ref: "feature_importance" },
      path: "/work/output/feature_importance.csv",
    },
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

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  const table = { feature: ["Sex", "Fare", "Age"], importance: [0.21, 0.14, 0.09] };
  fetchSpy = vi.fn(async (url: string) =>
    String(url).includes("/data/feature_importance")
      ? new Response(JSON.stringify(table), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

test("a non-prediction CSV renders as a data grid + path, with no Predictions Studio", async () => {
  render(<RunProvider connect={scriptConnect()}><Harness /></RunProvider>);
  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("running"));
  fireEvent.click(screen.getByText("go"));

  // The dataframe view + its source path render.
  await waitFor(() => expect(screen.getByTestId("dataframe-view")).toBeInTheDocument());
  await waitFor(() => expect(screen.getByTestId("artifact-path")).toBeInTheDocument());
  expect(screen.getByTestId("artifact-path").textContent).toContain("feature_importance.csv");

  // Predictions Studio must NOT appear (this isn't a labelled prediction set).
  expect(screen.queryByTestId("predictions-metrics")).toBeNull();

  // Rows fetched exactly once.
  expect(fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/data/feature_importance"))).toHaveLength(1);
});
