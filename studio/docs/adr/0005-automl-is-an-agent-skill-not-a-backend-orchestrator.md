# AutoML is an existing agent skill, not a new backend orchestrator

## Context

Grilling the plan against the codebase corrected a wrong assumption. The AutoML engine the frontend must surface **already exists** — as **Clair's `automl` agent skill** (shipped in the `ioa-agent` jar, `analyst/skills/automl/SKILL.md`). It is a complete, autonomous, Kaggle-grandmaster-grade pipeline:

EDA → preprocess → **data-leakage check** (hard gate) → feature engineering → deep feature synthesis → CAAFE semantic features → research top-5 candidates → candidate evaluation → merge → **iterative refinement with ablation studies** → ensemble (hill-climbing / stacking) → postprocess (Platt calibration, SHAP) → final held-out evaluation → 8-section report.

It is **Python-based** (sklearn / XGBoost / LightGBM / PyTorch, executed in the kernel), **checkpointed** via `state.json` for crash recovery, and **already human-in-the-loop**: it "asks once" at ambiguous decision points (task type, primary metric, compute budget), and the host wires `StreamResponseHandler.onQuestion(Question)` so the agent can ask the UI questions mid-run.

## Decision

**The frontend does NOT build or own an AutoML orchestrator.** It gives the existing `automl` agent skill a world-class surface:

- Render the skill's artifacts (`candidate_scores.md`, `refinement_log.md`) as the **Leaderboard**, and `eda_report.md` / `automl_report.md` / `DataViz` charts as live, first-class views.
- Surface the pipeline's stages and gates as a visible progress timeline (the skill already has explicit numbered steps and gates).
- Route the skill's "ask once" `onQuestion` prompts into inline human-in-the-loop UI.
- Treat the produced `solution_final.py` (a **Solution Pipeline**) as a distinct artifact from a JVM `.sml` **Trained Model**.

This supersedes ADR-0003 (no orchestrator to build) and reframes ADR-0004 (the leaderboard renders agent artifacts; the scoring conventions become rendering guidance).

## Consequences

- "Mostly automatic with human in the loop" is satisfied by the *existing* skill design; the frontend's job is transparency and control, not orchestration logic.
- Two model-production paths coexist and must both be represented (see ADR-0006): JVM-native `smile train`→`.sml`→serve, and agentic `automl`→`solution_final.py`.
- The frontend depends on the *shape* of the skill's artifacts. If the skill's output contract (filenames, the 8 report sections, the `Final Validation Performance:` line) changes, the UI must follow. This couples the UI to the agent-skill contract — an accepted, documented coupling.
- The daemon must expose the agent's stream (tokens, tool calls, `onQuestion`, status, the kernel runs it triggers) richly enough for the UI to visualize the pipeline — this is the real backend work, not orchestration.
