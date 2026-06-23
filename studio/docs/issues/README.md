# Explorable AutoML Cockpit — Issues

Vertical slices for [the Cockpit PRD](../PRD-explorable-automl-cockpit.md). Each is a tracer bullet (cuts through every layer, demoable on its own). All `ready-for-agent`. Kept local (not on the GitHub tracker), per the user's choice.

## Slices

| # | Slice | Blocked by | Stories |
|---|---|---|---|
| [S1](01-meta-field-prefactor.md) | `meta` field prefactor (Artifact contract) | — | enabler |
| [S2](02-predictions-studio-core.md) | Predictions Studio (core: slider, confusion, ROC) | — | 1–6, 9, 10 |
| [S3](03-predictions-drilldowns.md) | Predictions drill-downs (cell→rows, row→features, histogram) | S2 | 7, 8 |
| [S4](04-driver-diagnostics.md) | Driver Diagnostics (importance + ±std whiskers) | S1 | 24–28 |
| [S5](05-scorecard-and-task-type.md) | Scorecard + task_type (skill sidecar → metrics) | S1 | 11–15, 23 |
| [S6](06-interactive-leaderboard.md) | Interactive Leaderboard (summary.md, sort, bars, verdict) | — | 16–19, 22 |
| [S7](07-hyperparameter-drilldown.md) | Per-Candidate hyperparameter drill-down | S6, S1 | 20, 21 |
| [S8](08-close-the-loop-steering.md) | Close the Loop (Ask Clair about column + Next Steps) | — (soft: S4) | 29–32 |
| [S9](09-arrow-ipc-tabular-consolidation.md) | Arrow IPC tabular consolidation | — (separate track) | cross-cutting |

## Dependency graph

```
S1 ──┬─→ S4
     └─→ S5
S2 ──→ S3
S6 ──→ S7   (S7 also needs S1)
S8   (independent; S4 soft-enhances)
S9   (independent track)
```

**Grabbable on day one:** S1, S2, S6, S8 (and S9). Each issue is implemented in a fresh session via `/implement`, passed the PRD + the single issue.
