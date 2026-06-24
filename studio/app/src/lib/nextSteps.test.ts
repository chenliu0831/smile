import { parseNextSteps } from "./nextSteps";

const REPORT = `# AutoML Report

## Final Performance
Test AUC 0.921.

## Recommended Next Steps
1. **Add CatBoost** as a 4th learner.
2. Switch Platt → isotonic calibration.
3. Tune the threshold for F1.

## Appendix
Not a step.
`;

test("extracts the numbered items under the Recommended Next Steps heading", () => {
  expect(parseNextSteps(REPORT)).toEqual([
    "Add CatBoost as a 4th learner.",
    "Switch Platt → isotonic calibration.",
    "Tune the threshold for F1.",
  ]);
});

test("stops at the next heading and ignores other sections", () => {
  const steps = parseNextSteps(REPORT);
  expect(steps).not.toContain("Not a step.");
  expect(steps).toHaveLength(3);
});

test("handles bullet markers and a 'Next Steps' heading variant", () => {
  const md = `## Next Steps\n- Do X\n* Do Y\n`;
  expect(parseNextSteps(md)).toEqual(["Do X", "Do Y"]);
});

test("returns [] when the section is absent or input is empty", () => {
  expect(parseNextSteps("# Report\n\n## Final Performance\nblah")).toEqual([]);
  expect(parseNextSteps("")).toEqual([]);
  expect(parseNextSteps(null)).toEqual([]);
});

test("caps at 8 items", () => {
  const md = "## Next Steps\n" + Array.from({ length: 12 }, (_, i) => `${i + 1}. step ${i + 1}`).join("\n");
  expect(parseNextSteps(md)).toHaveLength(8);
});
