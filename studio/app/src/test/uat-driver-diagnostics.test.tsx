/**
 * UAT — Driver Diagnostics (S4, ADR-0011) through the REAL React UI. A transcript carries a
 * `diagnostics` artifact whose `meta` holds the importance array inline (no network); the
 * view renders, and clicking a feature surfaces the EDA actions and fires a `user-message`
 * steering turn. ECharts is stubbed (it draws to a canvas jsdom lacks); the click is driven
 * through the stub's onEvents so the seam is still exercised.
 */
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { vi, beforeEach, afterEach, test, expect } from "vitest";
import { RunProvider, useRunContext } from "../store/RunContext";
import { Canvas } from "../ui/Canvas";
import { useStore } from "zustand";
import { MockRunPlayer } from "../daemon/mock/player";
import type { connectRun } from "../daemon/connect";
import type { DaemonMessage } from "../daemon/protocol";

// Stub ECharts: render a marker, and expose a button that invokes onEvents.click so the
// feature-selection seam (which a real click would trigger) is testable in jsdom.
vi.mock("echarts-for-react", () => ({
  default: ({ onEvents }: { onEvents?: { click?: (p: { dataIndex: number }) => void } }) => (
    <button data-testid="echarts-click" onClick={() => onEvents?.click?.({ dataIndex: 0 })}>chart</button>
  ),
}));

const SCRIPT: DaemonMessage[] = [
  {
    type: "artifact",
    runId: "r",
    artifact: {
      ref: "diagnostics",
      kind: "diagnostics",
      title: "Driver Diagnostics",
      meta: {
        top5_features: [
          { feature: "Title_Mr", mean: 0.066, std: 0.018 },
          { feature: "Age", mean: 0.038, std: 0.014 },
        ],
      },
    },
  } as DaemonMessage,
  { type: "run-finished", runId: "r", status: "completed" } as DaemonMessage,
];

function scriptConnect(): typeof connectRun {
  const connect = async () => {
    const player = new MockRunPlayer(SCRIPT, { stepMs: 1 });
    return { connection: player, mode: "daemon" as const };
  };
  return connect as unknown as typeof connectRun;
}

const sentMessages: string[] = [];

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

let connect: ReturnType<typeof scriptConnect>;

beforeEach(() => {
  sentMessages.length = 0;
  connect = scriptConnect();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("renders importance bars and fires a steering turn when a feature is investigated", async () => {
  // Spy on the player's sendMessage so we observe the diagnostics buttons' outgoing turns.
  const origConnect = connect;
  connect = (async (...args: unknown[]) => {
    const res = await (origConnect as unknown as (...a: unknown[]) => Promise<{ connection: { sendMessage: (t: string) => void } }>)(...args);
    const real = res.connection.sendMessage.bind(res.connection);
    res.connection.sendMessage = (t: string) => { sentMessages.push(t); real(t); };
    return res;
  }) as unknown as typeof connect;

  render(
    <RunProvider connect={connect}>
      <Harness />
    </RunProvider>,
  );

  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("running"));
  fireEvent.click(screen.getByText("go"));

  // The diagnostics view renders (its chart marker appears once the artifact streams in).
  await waitFor(() => expect(screen.getByTestId("echarts-click")).toBeInTheDocument());

  // Click a feature → the EDA action panel appears with the stability readout. The stub
  // fires dataIndex 0; the chart renders bottom-up (strongest on top), so index 0 is the
  // bottom bar — "Age" — which is exactly what the action buttons should reference.
  await act(async () => { fireEvent.click(screen.getByTestId("echarts-click")); });
  await waitFor(() => expect(screen.getByTestId("diagnostics-actions")).toBeInTheDocument());
  expect(screen.getByText(/Ask Clair about Age/)).toBeInTheDocument();

  // "Ask Clair about <feature>" sends a templated user-message steering turn for that feature.
  fireEvent.click(screen.getByText(/Ask Clair about Age/));
  await waitFor(() => expect(sentMessages.some((m) => /"Age"/.test(m))).toBe(true));
});
