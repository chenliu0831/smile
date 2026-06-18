import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { App } from "./App";
import { RunProvider } from "./automl/RunContext";
import { RunZones } from "./ui/RunView";

test("renders the studio brand", () => {
  render(<App />);
  expect(screen.getByText(/Studio/)).toBeInTheDocument();
});

test("greets the user and shows a chat input on load", async () => {
  render(<App />);
  // The mock session emits a greeting turn from Clair, and a message box is present.
  await waitFor(() => expect(screen.getByText(/I'm Clair/i)).toBeInTheDocument());
  expect(screen.getByPlaceholderText(/Message Clair/i)).toBeInTheDocument();
});

test("sending a message starts the agent turn and streams pipeline stages", async () => {
  render(
    <RunProvider>
      <RunZones />
    </RunProvider>,
  );
  await waitFor(() => expect(screen.getByPlaceholderText(/Message Clair/i)).toBeInTheDocument());

  // Type a prompt and send it — this kicks off the scripted mock run.
  const box = screen.getByPlaceholderText(/Message Clair/i);
  fireEvent.change(box, { target: { value: "analyze churn" } });
  fireEvent.keyDown(box, { key: "Enter" });

  // The user's turn appears, and the agent's pipeline stages stream in.
  await waitFor(() => expect(screen.getByText("analyze churn")).toBeInTheDocument());
  await waitFor(() =>
    expect(screen.getByText(/Exploratory Data Analysis/i)).toBeInTheDocument(),
  );
});
