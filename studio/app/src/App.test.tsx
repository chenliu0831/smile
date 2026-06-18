import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";

test("renders the studio brand", () => {
  render(<App />);
  expect(screen.getByText(/Studio/)).toBeInTheDocument();
});

test("the mock AutoML run streams in (goal appears, pipeline stages render)", async () => {
  render(<App />);
  await waitFor(() => expect(screen.getByText(/churn/i)).toBeInTheDocument());
  await waitFor(() =>
    expect(screen.getByText(/Exploratory Data Analysis/i)).toBeInTheDocument(),
  );
});
