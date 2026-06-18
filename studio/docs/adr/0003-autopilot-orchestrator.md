---
status: superseded by ADR-0005
---

# Autopilot: a new orchestrator over existing single-algorithm training

> **SUPERSEDED.** This ADR assumed the AutoML engine had to be built as a sweep over `smile train`. That is incorrect. Codebase grounding (the `ioa-agent` jar's `analyst/skills/automl/SKILL.md`) revealed a complete, autonomous, agent-orchestrated AutoML pipeline already exists as **Clair's `automl` skill**. See **ADR-0005** for the corrected architecture. Original text retained below for history.

---

The AutoML-guided experience requires a capability that does not exist today: `smile train` trains exactly **one** algorithm per invocation, with no sweep, ranking, or leaderboard. We introduce a daemon-side **Autopilot** orchestrator and a new domain: an **Experiment** (dataset + target + objective) spawns many **Trials** (one algorithm + config, cross-validated) and produces a ranked **Leaderboard**.

Autopilot is a sweep-and-rank layer on top of the existing algorithm coverage (~15 algorithms) and cross-validation machinery — **not** a reimplementation of training.
