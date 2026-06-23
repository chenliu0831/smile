/**
 * UAT — Predictions Studio (S2, ADR-0011) through the REAL React UI. Drives a daemon-free
 * session whose transcript carries a `dataframe` prediction artifact, stubs the /data/{ref}
 * endpoint with a proba/actual table, and asserts the full client-side path: the panel
 * renders metric readouts, and dragging the threshold slider recomputes them WITHOUT any
 * further network call (the rows are fetched once).
 */
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { vi, beforeEach, afterEach, test, expect } from "vitest";

// ECharts draws to a <canvas>, which jsdom doesn't implement. This UAT verifies the data
// flow and the client-side slider recompute (plain-DOM metric readouts), not ECharts'
// pixels — so stub the chart component to a marker div.
vi.mock("echarts-for-react", () => ({ default: () => <div data-testid="echarts" /> }));
import { RunProvider, useRunContext } from "../store/RunContext";
import { Canvas } from "../ui/Canvas";
import { useStore } from "zustand";
import { MockRunPlayer } from "../daemon/mock/player";
import type { connectRun } from "../daemon/connect";
import type { DaemonMessage } from "../daemon/protocol";

const HTTP_BASE = "http://127.0.0.1:0/api/v1";

// A minimal transcript: a `dataframe` prediction artifact referencing the materialized
// `submission` session table, then the run finishes.
const SCRIPT: DaemonMessage[] = [
  {
    type: "artifact",
    runId: "r",
    artifact: {
      ref: "submission",
      kind: "dataframe",
      title: "Predictions",
      data: { kind: "arrow", ref: "submission" },
      path: "/tmp/work/final/submission.csv",
    },
  } as DaemonMessage,
  { type: "run-finished", runId: "r", status: "completed" } as DaemonMessage,
];

/** A connectRun-shaped factory backed by the inline script, with a real httpBase so the
 * Predictions Studio fetch fires (the bare MockRunPlayer reports httpBase=null). */
function scriptConnect(): typeof connectRun {
  const connect = async () => {
    const player = new MockRunPlayer(SCRIPT, { stepMs: 1 });
    (player as unknown as { httpBase: () => string | null }).httpBase = () => HTTP_BASE;
    return { connection: player, mode: "daemon" as const };
  };
  return connect as unknown as typeof connectRun;
}

/** Renders the canvas over whatever artifacts the store currently holds, and kicks the run. */
function CanvasHarness() {
  const { store, sendMessage } = useRunContext();
  const session = useStore(store, (s) => s.session);
  // The MockRunPlayer waits for the first user message before pumping its script.
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
  // /data/submission → a small, separable proba/actual table (3 pos, 3 neg).
  const table = {
    PassengerId: [1, 2, 3, 4, 5, 6],
    Survived_proba: [0.9, 0.8, 0.6, 0.4, 0.2, 0.1],
    Survived_actual: [1, 1, 0, 1, 0, 0],
  };
  fetchSpy = vi.fn(async (url: string) => {
    if (String(url).includes("/data/submission")) {
      return new Response(JSON.stringify(table), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders Predictions Studio and recomputes metrics on threshold change, fetching once", async () => {
  render(
    <RunProvider connect={scriptConnect()}>
      <CanvasHarness />
    </RunProvider>,
  );

  // Wait for the connection to attach (connect() is async) before kicking the run, else
  // sendMessage no-ops against a still-null connection.
  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("running"));
  // Kick the scripted run so the artifact streams in.
  fireEvent.click(screen.getByText("go"));

  // The panel renders its metric strip (the honesty label proves it's Predictions Studio).
  await waitFor(() => expect(screen.getByText("recomputed from hold-out")).toBeInTheDocument());

  // The rows were fetched exactly once over /data/{ref}.
  const dataCalls = fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/data/submission"));
  expect(dataCalls).toHaveLength(1);

  const metricsAt = () => screen.getByTestId("predictions-metrics").textContent ?? "";
  // At the default 0.50 operating point: acc 4/6 ≈ 0.667.
  await waitFor(() => expect(metricsAt()).toMatch(/0\.667/));
  const before = metricsAt();

  // Drag the threshold to 0.95 — now only the 0.9 row is predicted positive, so the
  // confusion matrix (and therefore the readouts) MUST change.
  const slider = screen.getByRole("slider") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(slider, { target: { value: "0.95" } });
  });

  await waitFor(() => expect(metricsAt()).not.toBe(before));
  // Still only one data fetch — the slider recompute is purely client-side.
  expect(fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/data/submission"))).toHaveLength(1);
});
