import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { App } from "./App";
import { RunProvider } from "./automl/RunContext";
import { RunZones } from "./ui/RunView";

test("renders the studio brand", () => {
  render(<App />);
  expect(screen.getByText(/Studio/)).toBeInTheDocument();
});

test("cold start shows the Clair welcome hero, starter chips, and a persistent chat input", async () => {
  render(<App />);
  // Revamp: the chat-welcome hero greets the user (not a bare empty state).
  await waitFor(() => expect(screen.getByText(/I'm Clair/i)).toBeInTheDocument());
  // Starter-prompt chips teach the interaction model with zero typing.
  expect(screen.getByRole("button", { name: /What can you do/i })).toBeInTheDocument();
  // The chat input is always present (persistent chrome, not a closeable tab).
  expect(screen.getByPlaceholderText(/Message Clair/i)).toBeInTheDocument();
});

test("clicking a starter chip sends that prompt as a user turn", async () => {
  render(<App />);
  await waitFor(() => expect(screen.getByText(/I'm Clair/i)).toBeInTheDocument());
  // (cold start, no dataset → the "What can you do?" chip is available)
  fireEvent.click(screen.getByRole("button", { name: /What can you do/i }));
  await waitFor(() =>
    expect(screen.getByText(/what kinds of analysis/i)).toBeInTheDocument(),
  );
});

test("sending a message starts the agent turn and streams pipeline stages", async () => {
  render(
    <RunProvider>
      <RunZones />
    </RunProvider>,
  );
  await waitFor(() => expect(screen.getByPlaceholderText(/Message Clair/i)).toBeInTheDocument());

  const box = screen.getByPlaceholderText(/Message Clair/i);
  fireEvent.change(box, { target: { value: "analyze churn" } });
  fireEvent.keyDown(box, { key: "Enter" });

  await waitFor(() => expect(screen.getByText("analyze churn")).toBeInTheDocument());
  await waitFor(() =>
    expect(screen.getByText(/Exploratory Data Analysis/i)).toBeInTheDocument(),
  );
});
