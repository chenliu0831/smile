---
status: superseded by ADR-0005
---

# Leaderboard scoring contract

> **SUPERSEDED by ADR-0005.** The "Leaderboard of Trials produced by a daemon orchestrator" framing was based on a wrong assumption (see ADR-0003). Clair's existing `automl` skill produces a `candidate_scores.md` table and a `refinement_log.md` instead — the UI renders *those* as the leaderboard rather than driving a JVM trial-sweep. The scoring conventions below (problem-type-aware metric, CV-by-default, show-the-regime) remain good UI guidance for rendering the agent's candidate scores. Original text retained below.

---

The **Leaderboard** ranks **Trials** by a **problem-type-aware default metric**, mirroring the verified conventions of H2O AutoML and SageMaker Autopilot:

- **Binary classification** → AUC
- **Multiclass classification** → mean-per-class-error
- **Regression** → RMSE (deviance under an auto setting)

Companion metrics (logloss, accuracy, MSE, MAE, RMSLE, etc.) are shown as **sortable columns** so the user can re-rank.

Scores default to **5-fold cross-validation**. The user may supply a **holdout frame** to switch the scoring regime. The Leaderboard **displays which regime produced each score** (CV vs holdout) — a deliberate, documented defense against the AutoML "leakage / can't-trust-the-score" criticism.

This reuses Smile's existing `Metrics` and `CrossValidation` machinery; Autopilot only aggregates and ranks.

## Scope

- **Phase 1 ships single-algorithm Trials only.** Ensemble Trials ("all models" stacked + "best of family") are **deferred to a later phase** — they are additive rows that do not change the ranking contract, but add orchestration (train base models, then stack).

## Consequences

- The default sort metric is determined by detected problem type; the UI must expose and allow overriding it.
- Persisted Trial scores must record their scoring regime so historical Leaderboards remain interpretable.
