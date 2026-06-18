import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import { RunProvider } from "./automl/RunContext";
import { RunZones } from "./ui/RunView";

test("renders the studio brand", () => {
  render(<App />);
  expect(screen.getByText(/Studio/)).toBeInTheDocument();
});

test("the mock AutoML run connects and streams the goal into the shell", async () => {
  render(<App />);
  // The run connects (mock fallback) and the goal reaches the topbar chrome.
  await waitFor(() => expect(screen.getByText(/churn/i)).toBeInTheDocument());
});

test("the three-zone Run view renders pipeline stages as the run streams", async () => {
  // RunZones is the dock panel body; test it directly so the assertion isn't gated
  // by dockview's layout engine (which does not size panels under jsdom).
  render(
    <RunProvider>
      <RunZones />
    </RunProvider>,
  );
  await waitFor(() =>
    expect(screen.getByText(/Exploratory Data Analysis/i)).toBeInTheDocument(),
  );
});
