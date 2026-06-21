/**
 * UAT — the summarize flow through the REAL React UI (not just the reducer), replaying the
 * captured /ws/run transcript via an injected fixtureConnect. Proves the components render a
 * genuine daemon turn: the user message appears, the agent's summary prose renders, and the
 * chat returns to a ready (non-streaming) state. This is the highest-fidelity daemon-free UAT.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { RunProvider } from "../store/RunContext";
import { RunZones } from "../ui/RunView";
import { fixtureConnect } from "./harness";

// Replay with a small per-frame delay so the React effect + timers drain naturally.
const connect = fixtureConnect({ player: { stepMs: 1 } });

test("clicking through a summarize turn renders the agent's real summary in the chat", async () => {
  render(
    <RunProvider connect={connect}>
      <RunZones />
    </RunProvider>,
  );
  // greeting from the captured session-started
  await waitFor(() => expect(screen.getByPlaceholderText(/Message Clair/i)).toBeInTheDocument());

  const box = screen.getByPlaceholderText(/Message Clair/i);
  fireEvent.change(box, { target: { value: "Summarize the dataset" } });
  fireEvent.keyDown(box, { key: "Enter" });

  // the user turn renders
  await waitFor(() => expect(screen.getByText("Summarize the dataset")).toBeInTheDocument());

  // the agent's REAL captured summary prose renders (titanic-specific facts). The summary is
  // a markdown table, so the text is split across many DOM nodes — assert on the whole
  // rendered document text rather than a single text node. Use a prose-only phrase (the bare
  // case-insensitive "titanic" would also match the "[Describing table: titanic]" echo).
  await waitFor(
    () => expect(document.body.textContent || "").toMatch(/Titanic Dataset Summary|891 rows|Missing values/),
    { timeout: 5000 },
  );
  // and the chat returns to a ready state (not stuck streaming)
  await waitFor(() => {
    const box = screen.getByPlaceholderText(/Message Clair/i) as HTMLTextAreaElement;
    expect(box.disabled).toBe(false);
  });
}, 10000);
