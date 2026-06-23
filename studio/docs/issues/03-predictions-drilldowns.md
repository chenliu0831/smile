# S3 — Predictions Studio drill-downs (cell → rows, row → features, separation histogram)

> ready-for-agent · PRD: ../PRD-explorable-automl-cockpit.md · ADR-0011, ADR-0013

## What to build

Deepen **Predictions Studio** from a readout into an inspector, on the same client-side prediction rows S2 already loads (no new data path).

End-to-end: clicking a confusion-matrix cell (ECharts per-element click) lists the prediction rows falling in that cell at the current threshold; clicking a misclassified row expands its feature values. Add a probability-separation histogram by true class, so the user sees how cleanly the model separates classes. All of this is derived client-side from the in-memory rows; the row→feature expansion uses the columns already present in the prediction set.

## Acceptance criteria

- [ ] Clicking a confusion-matrix cell shows the list of rows in that cell, consistent with the current threshold.
- [ ] Clicking a (misclassified) row expands its feature values inline.
- [ ] A probability-separation histogram by true class renders from the prediction rows.
- [ ] Cell→list and the histogram recompute correctly when the threshold changes.
- [ ] A replay-fixture UAT asserts the cell-click row list and the row-expansion behavior.

## Blocked by

- S2 — Predictions Studio (core)
