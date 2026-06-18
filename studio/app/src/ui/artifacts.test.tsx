import { render, screen } from "@testing-library/react";
import { Leaderboard } from "./Leaderboard";
import { Markdown } from "./Markdown";

const LB = `
| Candidate | Val Score | Std (CV) | Params | Runtime (s) | Notes |
|---|---|---|---|---|---|
| candidate_lgbm | 0.913 | 0.008 | lr=0.05 | 42 | gbm |
| candidate_rf | 0.881 | 0.011 | trees=500 | 31 | rf |
`;

test("Leaderboard renders ranked rows with the best candidate first", () => {
  render(<Leaderboard markdown={LB} />);
  const rows = screen.getAllByRole("row");
  // header + 2 candidates
  expect(rows).toHaveLength(3);
  // best candidate (lgbm) appears before rf
  expect(screen.getByText("candidate_lgbm")).toBeInTheDocument();
  expect(screen.getByText("0.913")).toBeInTheDocument();
});

test("Markdown renders headings, bold and inline code", () => {
  render(<Markdown source={"# Title\n\nTest **AUC 0.92** with `lgbm`."} />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Title");
  expect(screen.getByText("AUC 0.92").tagName).toBe("STRONG");
  expect(screen.getByText("lgbm").tagName).toBe("CODE");
});
