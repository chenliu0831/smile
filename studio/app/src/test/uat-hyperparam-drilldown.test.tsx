/**
 * UAT — per-Candidate hyperparameter drill-down (S7, ADR-0011/0014). The Leaderboard, given a
 * tuned-params companion (parsed from best_params.json), makes matching rows expandable to
 * their params with a default-vs-tuned delta and a "copy as Python dict" action. Rows without
 * params stay plain. Exercises the join (lib/params) through the real component.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, test, expect } from "vitest";
import { Leaderboard } from "../ui/Leaderboard";
import { parseParams } from "../lib/params";

const LB = `
| Candidate | Val Score | Std (CV) | Params | Runtime (s) | Notes |
|---|---|---|---|---|---|
| candidate_xgb | 0.908 | 0.009 | d=6 | 51 | tuned |
| candidate_rf | 0.881 | 0.011 | t=500 | 31 | random forest |
`;

const paramsByModel = parseParams({
  xgb: {
    params: { n_estimators: 406, max_depth: 5, learning_rate: 0.094 },
    default_params: { n_estimators: 100, max_depth: 6, learning_rate: 0.3 },
  },
  // No entry for rf → that row must stay non-expandable.
});

test("expands a row with tuned params, shows the default delta, and copies a Python dict", async () => {
  const writeText = vi.fn();
  vi.stubGlobal("navigator", { clipboard: { writeText } });

  render(<Leaderboard markdown={LB} paramsByModel={paramsByModel} />);

  // The xgb row is an expand affordance; rf (no params) is plain text.
  const xgbToggle = screen.getByRole("button", { name: /candidate_xgb/ });
  expect(screen.queryByRole("button", { name: /candidate_rf/ })).toBeNull();

  // Expand → params table appears with the tuned value and its default for the delta.
  fireEvent.click(xgbToggle);
  await waitFor(() => expect(screen.getByTestId("lb-params")).toBeInTheDocument());
  const panel = screen.getByTestId("lb-params");
  expect(panel.textContent).toMatch(/n_estimators/);
  expect(panel.textContent).toMatch(/406/);   // tuned
  expect(panel.textContent).toMatch(/100/);   // default

  // Copy as Python dict writes a literal to the clipboard.
  fireEvent.click(screen.getByRole("button", { name: /copy as Python dict/ }));
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText.mock.calls[0][0]).toMatch(/'n_estimators': 406/);

  vi.unstubAllGlobals();
});

test("renders normally (no expand affordance) when no params companion is present", () => {
  render(<Leaderboard markdown={LB} />);
  expect(screen.queryByRole("button", { name: /candidate_xgb/ })).toBeNull();
  expect(screen.getByText("candidate_xgb")).toBeInTheDocument();
});
