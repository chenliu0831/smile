---
name: automl
description: >-
  Run an end-to-end automated machine learning pipeline that covers EDA,
  preprocessing, feature engineering, model selection, hyperparameter tuning,
  architecture search, ensembling, postprocessing, and evaluation — with iterative
  self-improvement. Use when the user says "build an ML pipeline", "run AutoML",
  "automate the ML workflow", "find the best model for my data", "end-to-end ML",
  "solve this ML problem automatically", "compete on this dataset",
  "train a model on my CSV", or "optimize model performance automatically".
---
<!--
OVERLAY COPY — DO NOT treat as original source.

Near-verbatim copy of the `automl` skill's SKILL.md from the vendored ioa-agent jar, carried
in serve/ioa-overlay/ so the daemon can shadow the jar's copy via PYTHONPATH (the overlay dir
is placed AHEAD of the jar; `ioa` is a PEP-420 namespace package, so Python merges the two and
prefers this file). See serve/ioa-overlay/.../summarize/scripts/analyze.py for the mechanism.

The ONLY change from upstream is the added final step in `## Output Contract` (item 7):
emit `output/final_metrics.json` via the overlay's emit_final_metrics.py, the structured public
sidecar the Smile Studio Scorecard consumes (ADR-0011/0014). Everything else is upstream.

If you re-vendor a newer ioa-agent jar, diff this file against the jar's SKILL.md and re-apply
the item-7 addition (and the accompanying emit_final_metrics.py script).
-->
# AutoML: Automated Machine Learning Pipeline

## Goal
Deliver the best-performing, leakage-free, reproducible ML solution for a given dataset and task by systematically executing the full pipeline, iteratively refining each component using research + ablation studies, and ensembling the top solutions — all checkpointed for crash recovery and documented in a final report.

## Procedures

### 0. Prerequisites, Environment, and Planning
Before any work begins:
1. Confirm the **task type**: binary classification, multi-class classification, regression, time-series forecasting, or clustering. If unknown, ask once.
2. Confirm the **primary metric**. If unspecified:
   - Binary classification → AUC-ROC
   - Multi-class classification → F1-weighted
   - Regression → RMSE
   - Time-series forecasting → MASE
   - Clustering → Silhouette Score
   State the chosen metric explicitly.
3. Confirm the **compute budget** (wall-clock hours). Default: **2 hours**.
4. Confirm the **data location** (`./input/` directory). Verify train file exists and list file names.
   - If **no test file** is found: set `no_test_set = true` in `state.json`. In step 10, skip held-out test evaluation and report OOF score as proxy; note the absence in the report.
5. For **time-series tasks**: confirm the timestamp column and forecast horizon. All splits must be time-ordered — never shuffled.
6. For **small datasets** (`n < 5 000`): set validation strategy to **5-fold CV** instead of single hold-out for all candidate evaluations.
7. Set the **improvement threshold**: stop iterating when validation metric improves by < 0.001 over 3 consecutive refinement cycles.
8. Create directories: `./output/`, `./output/checkpoints/`, `./final/`.
9. Install dependencies: run `pip install -r scripts/requirements.txt` to ensure all required libraries are available.
10. **Detect GPU**: run `python3 -c "import torch; print(torch.cuda.is_available())"`. Record `gpu_available` in `state.json`. If `false`, do not invoke `neural-architecture-search`; set NAS budget to 0.
11. Invoke the **`model-selection`** skill with the task type, data modality, and dataset summary to get the recommended model family before researching candidates.
12. Write the initial pipeline state to `output/checkpoints/state.json`:
    ```
    python3 -m ioa.agent.analyst.skills.automl.scripts.pipeline_runner --init
    ```

> **Clustering fast-path**: For clustering tasks, skip leakage checks (steps 2–3 data-leakage-checker), Platt scaling (step 9), and held-out test retrain (step 10). Evaluate Silhouette, Davies-Bouldin, and Calinski-Harabasz. Search k in `[2, min(20, n//50)]`; if `n < 100`, limit k ≤ 5. Save cluster assignments to `final/submission.csv` with columns `[id, cluster]`.

### 1. Exploratory Data Analysis
**Action**: Invoke the `exploratory-data-analysis` skill.
- Pass the task type, primary metric, and timestamp column (if time-series).
- Output: `output/eda_report.md`.
- Extract and record in `output/checkpoints/state.json`:
  - Target column name and class distribution (or value range for regression).
  - Top-5 most predictive features (by correlation or mutual information).
  - Data quality issues: missing columns, type mismatches, outliers, duplicates.
  - Recommended preprocessing actions.
  - Dataset size `n` (update CV strategy if `n < 5 000`).
  - Number of numeric features (`numeric_feature_count`).
  - For regression: target skewness. If all target values > 0 and skewness > 1.5, record `log_target = true`; apply `log1p` to target before training and `expm1` to predictions in postprocessing.
  - For binary/multi-class: class imbalance ratio. If ratio > 10:1 (binary) or any class < 5% of samples (multi-class): record `imbalanced = true`.
- **Gate 1**: If target column has only 1 unique value (classification), or regression target std = 0: halt immediately and report "Target column is constant — ML is not applicable."
- **Gate 2**: Do not proceed to step 2 until `output/eda_report.md` exists and data quality issues are documented.

### 2. Data Preprocessing
**Action**: Invoke the `preprocess` skill.
- Pass `imbalanced` flag from state.json.
- If `numeric_feature_count = 0`: skip all scaling steps; pass `numeric_feature_count = 0` to the `preprocess` skill.
- Use EDA findings to configure imputation, encoding, and scaling strategies.
- For time-series: use time-ordered split; never shuffle rows.
- Save cleaned data as `output/train_clean.csv` and `output/test_clean.csv`.
- **Run the data leakage checker** ([references/data-leakage-checker.md](references/data-leakage-checker.md)):
  - Use `scripts/leakage_check_runner.py` to invoke it — run:
    ```
    python3 -m ioa.agent.analyst.skills.automl.scripts.leakage_check_runner
    ```
    and parse the JSON result.
  - If `leakage_status = "Yes Data Leakage"`: invoke the data leakage fixer ([references/data-leakage-fixer.md](references/data-leakage-fixer.md)), then re-run the checker until clean.
- **Run the data usage checker** ([references/data-usage-checker.md](references/data-usage-checker.md)) to confirm all available features are incorporated.
- Update `output/checkpoints/state.json` with `step: 2, status: complete`.
- **Gate**: Do not proceed until `No Data Leakage` is confirmed.

### 2b. Resampling (if applicable)
**Condition**: Execute this step only if `imbalanced = true` in state.json AND task type is binary or multi-class classification.
**Action**: Invoke the `resampling` skill.
- Pass: target column, train/test split paths (`output/train_clean.csv`, `output/test_clean.csv`), imbalance ratio, `numeric_feature_count`, and primary metric.
- The `resampling` skill will: assess severity, select the appropriate technique (SMOTE, SMOTENC, RandomOverSampler, hybrid, or class weighting), establish a baseline, apply resampling to the training set only, evaluate improvement, and produce `output/train_resampled.csv`.
- After the skill completes: replace `output/train_clean.csv` with `output/train_resampled.csv` as the canonical training artifact for all downstream steps.
- If `resampling` skill reports "No improvement after all techniques": do **not** revert; instead record `resampling_strategy = class_weight_only` in state.json and pass `class_weight='balanced'` to all candidate scripts in step 4.
- Update checkpoint: `step: 2b, resampling_technique: <name>, post_resampling_minority_f1: <score>`.
- **Gate**: Do not proceed until `output/train_resampled.csv` (or confirmed class-weighting decision) exists.

### 3. Feature Engineering
**Action**: Invoke the `feature-engineering` skill.
- Pass task type, target column, EDA feature importance rankings, and (for time-series) the timestamp column.
- Pass `imbalanced` flag and `resampling_strategy` from state.json.
- Use `output/train_resampled.csv` as the training input if it exists; otherwise use `output/train_clean.csv`.
- Save updated data as `output/train_features.csv` and `output/test_features.csv`.
- Record feature count (before → after) in `output/checkpoints/state.json`.
- **Duplicate column check**: verify `output/train_features.csv` has no duplicate column names. If duplicates exist, rename with `_1`, `_2` suffixes and log the count.
- **High-dimension gate**: if feature count after engineering > 1 000, run variance-threshold + mutual-information selection to reduce to top 500 features. Log the reduction in state.json.
- **Run the data leakage checker** on the feature-engineering code — new features can introduce leakage.
- Update checkpoint: `step: 3, status: complete`.

### 3b. Deep Feature Synthesis (if applicable)
**Condition**: Execute this step only if **multiple related tables** are present in `./input/` (i.e., tables joinable by foreign key relationships).
**Action**: Invoke the `deep-feature-synthesis` skill.
- Pass: all table file paths, identified primary/foreign keys from EDA, target entity table (the table whose rows are the prediction unit), target column, and train/test split.
- The `deep-feature-synthesis` skill will: build a Featuretools EntitySet, run DFS at `max_depth=2`, clean the feature matrix, and produce `output/train_features_dfs.csv` and `output/test_features_dfs.csv`.
- After the skill completes: **merge** the DFS feature columns into `output/train_features.csv` and `output/test_features.csv` by joining on the entity index.
- Re-run the **duplicate column check** and **high-dimension gate** after merging.
- Re-run the **data leakage checker** on the merged feature set.
- Update checkpoint: `step: 3b, dfs_features_added: <count>, status: complete`.
- **Gate**: Do not proceed until the merged feature set passes the leakage check.

### 3c. CAAFE Semantic Feature Generation (if applicable)
**Condition**: Execute this step only if ALL of the following are true:
- Task type is binary or multi-class classification.
- A **dataset description** is available (from EDA report, README, or user input).
- Remaining compute budget allows at least 10 CAAFE iterations (estimate: ~5 min per iteration).

**Action**: Invoke the `caafe` skill.
- Pass: `output/train_features.csv` (post-DFS merged if applicable), `output/test_features.csv`, target column, dataset description, primary metric, and `iterations = min(20, remaining_budget_minutes // 5)`.
- The `caafe` skill will: use a `general-purpose` subagent to iteratively propose semantically meaningful features, evaluate each via local cross-validation, accept improving features, and update `output/train_features.csv` and `output/test_features.csv` in-place.
- Re-run the **data leakage checker** on `output/caafe_features.py` (inspect generated code for target column references).
- Record in state.json: `caafe_features_accepted: <count>`, `caafe_cv_delta: <improvement>`.
- If CAAFE accepted 0 features: log `CAAFE_NO_IMPROVEMENT`; continue with the pre-CAAFE feature set.
- Update checkpoint: `step: 3c, status: complete`.

### 4. Research: Identify Top Candidate Solutions
**Action**: Use [references/research.md](references/research.md) to identify the **top 5 candidate approaches** for this specific task, data type, and the model family recommended by `model-selection` (step 0).
- Ensure diversity: ≥1 gradient boosting, ≥1 neural network, ≥1 fundamentally different approach.
- All candidate scripts must load data from `output/train_features.csv` (not `./input/`).
- If `resampling_strategy = class_weight_only`: all candidate scripts must include `class_weight='balanced'` (or equivalent) in their model constructor.
- Save each as `output/candidate_<name>.py` with all required properties from the research reference.
- If fewer than 5 strong candidates exist for the specific task: use 3 minimum; note the shortfall in `output/candidate_scores.md`.
- Update checkpoint: `step: 4, count: <N candidates saved>`.
- **Gate**: All candidates must have saved, syntactically valid Python files before proceeding.

### 5. Candidate Evaluation
For each candidate script, use [references/candidate-evaluation.md](references/candidate-evaluation.md):
1. Run the script:
   ```
   python3 -m ioa.agent.analyst.skills.automl.scripts.pipeline_runner --run output/candidate_<name>.py
   ```
2. Parse the score:
   ```
   python3 -m ioa.agent.analyst.skills.automl.scripts.score_parser
   ```
   — extract `Final Validation Performance: {score}`.
   - If `score_parser.py` returns no score (empty output or parse error): treat as script failure; apply the 3-debug-attempt rule.
3. If script errors: invoke [references/debugger.md](references/debugger.md). Allow **3 debug attempts**; discard if still failing.
4. For small datasets (`n < 5 000`): each candidate must use 5-fold CV; report mean ± std.
5. Record results in `output/candidate_scores.md`:

   | Candidate | Val Score | Std (CV) | Params | Runtime (s) | Notes |
   |---|---|---|---|---|---|
   | candidate_lgbm | ... | ... | ... | ... | ... |

6. Select the **top 2 candidates** per the criteria in [references/candidate-evaluation.md](references/candidate-evaluation.md).
7. Update checkpoint: `step: 5, best_candidate: <name>, best_score: <score>`.

### 6. Merge Top Candidates into Initial Solution
**Action**: Use [references/merge-solution.md](references/merge-solution.md) to integrate the top-2 candidates.
- Save merged solution as `output/solution_v1.py`.
- Run: leakage checker + data usage checker + score parser.
- If `score_parser` returns no score: debug once; if still no score, keep best single candidate as `solution_v1.py` and log `MERGE_FAILED`.
- If merged score < best single candidate score: keep best single candidate as `solution_v1.py` and log `MERGE_FAILED`.
- Update checkpoint: `step: 6, merged_score: <score>`.

### 7. Iterative Refinement Loop
**Budget tracking**: Before each cycle, and before each sub-step within a cycle, check elapsed time. If remaining budget < 20% of total, skip to step 8. If a single sub-step is projected to exceed remaining budget, skip it and log `SKIPPED_BUDGET`.

Repeat until stopping criterion (< 0.001 improvement for 3 consecutive cycles, OR budget < 20%):

#### 7a. Ablation Study
- Run [references/ablation-study.md](references/ablation-study.md) on current best solution via:
  ```
  python3 -m ioa.agent.analyst.skills.automl.scripts.pipeline_runner --run <current_solution.py>
  ```
- Parse all `ABLATION[*]:` lines with:
  ```
  python3 -m ioa.agent.analyst.skills.automl.scripts.score_parser
  ```
- Summarise with [references/ablation-summary.md](references/ablation-summary.md).
- Save as `output/ablation_cycle_N.md`.
- Update checkpoint: `refinement_cycle: N, ablation: complete`.

#### 7b. Extract, Plan, and Refine
- Invoke [references/extract-code-block.md](references/extract-code-block.md) → get `{code_block, plan, target_component}`.
- Invoke [references/refine-code-block.md](references/refine-code-block.md) → produce improved block.
- Splice improved block into current solution; save as `output/solution_vN.py`.
- Run leakage checker + data usage checker.
- Run `solution_vN.py` and parse score:
  ```
  python3 -m ioa.agent.analyst.skills.automl.scripts.pipeline_runner --run output/solution_vN.py
  python3 -m ioa.agent.analyst.skills.automl.scripts.score_parser
  ```
- If `score_parser` returns no score: treat as failure; revert to previous solution.
- If new score > previous best: update checkpoint `best_version: vN, best_score: <score>`.
- If new score ≤ previous: revert; invoke [references/planner.md](references/planner.md) for an alternative plan; retry once.
- If retry also fails: increment no-improvement counter.
- Log to `output/refinement_log.md`: `cycle | version | val_score | delta | plan | status`.

#### 7c. Model-Specific Tuning (time-boxed)
- **Time box**: allocate at most 25% of remaining budget to tuning; re-check elapsed time before invoking.
- If current solution uses tunable hyperparameters (GBDT, SVM, MLP): invoke `hyperparameter-tuning` skill with `max_trials=20`.
- If primary model is neural **and** `gpu_available = true`: invoke `neural-architecture-search` skill with `budget_hours = 0.25 × remaining_budget`. Skip NAS if `gpu_available = false`.
- After tuning, save the tuned script as `output/solution_vN_tuned.py`; run and parse score. If tuned score beats `solution_vN.py`, set `solution_vN_tuned.py` as the new current best and update checkpoint.

### 8. Ensemble Strategy
After refinement loop exits:
1. Collect all versions from `output/refinement_log.md` that beat `solution_v1.py` baseline score.
2. **Diversity check**: if all improved solutions use the same algorithm family, skip stacking — use weighted average only.
3. If < 2 improved solutions exist: proceed with best single model as `output/solution_final.py`.
4. If ≥ 2 improved solutions exist (max 5 members cap):
   - Invoke [references/ensemble-strategy.md](references/ensemble-strategy.md); pass all previous plans and scores.
   - Invoke [references/ensembler.md](references/ensembler.md) to implement. Generate OOF predictions for stacking via:
     ```
     python3 -m ioa.agent.analyst.skills.automl.scripts.pipeline_runner --oof
     ```
     - OOF output must be saved as `output/oof_<modelname>.csv` with columns `[index, oof_pred]`. For multi-class: one column per class. The ensembler must align all OOF arrays by the training index before fitting the meta-learner.
   - Run leakage checker on ensemble script.
   - Parse ensemble score.
   - If ensemble score ≤ best single: use best single; log `ENSEMBLE_FAILED`.
5. Save final as `output/solution_final.py`. Update checkpoint: `step: 8, final_score: <score>`.

### 9. Postprocessing
**Action**: Invoke the `postprocess` skill on `solution_final.py`'s validation predictions.
- Classification: apply Platt scaling calibration; verify calibration with reliability diagram.
- Regression:
  - Clip predictions to `[train_target.min(), train_target.max()]`.
  - If `log_target = true` in state.json: apply `expm1` to all predictions before saving.
- All tasks: run feature contribution (SHAP or permutation importance); report top-5 features.
- Save calibrated/transformed predictions and explanations to `output/postprocess_results.json`.

### 10. Final Evaluation
**Action**: Invoke the `model-evaluation` skill.
- If `no_test_set = true`: report OOF score from step 7b as the final metric; skip held-out evaluation; note this in the report.
- Otherwise: retrain `solution_final.py` on full train set (train + val combined). Evaluate on held-out test set — first and only use of test data in the entire pipeline.
- Compare: test metric vs best candidate baseline (step 5) vs merged baseline (step 6) vs business threshold.
- Compute improvement %: `(final - baseline) / |baseline| × 100`.
- Save `output/model_evaluation_report.md`.
- Update checkpoint: `step: 10, test_score: <score>, status: complete`.

### 11. Reproducibility and Documentation
**Actions:**
1. Pin all library versions: run `pip freeze > output/requirements_final.txt`.
2. Save the winning solution with a fixed random seed at the top: `RANDOM_SEED = 42`.
3. Save the final test predictions to `final/submission.csv`.
4. Save `output/automl_report.md` with **exactly these 8 sections**:
   - `## Problem Setup` — task, metric, data shape (rows × cols), compute budget used, CV strategy, `gpu_available`, `imbalanced`, `log_target`, `no_test_set`, `dfs_applied`, `caafe_applied`
   - `## Pipeline Steps Executed` — checklist: ✓/✗ for each of the 13 steps (0–3c, 4–11)
   - `## Candidate Comparison` — table from step 5 including runtime and std
   - `## Refinement History` — full `refinement_log.md` table
   - `## Final Solution` — model(s), ensemble method, hyperparameters, random seed
   - `## Final Performance` — test metric (or OOF proxy if no test set) vs step-5 baseline vs step-6 merged vs business threshold; improvement %
   - `## Key Insights` — top-3 findings from ablation + feature importance
   - `## Recommended Next Steps` — numbered, prioritised actions
5. In-chat summary: task, final test metric, improvement % over baseline, ensemble composition, top-3 insights.

## Checkpoint Resume Protocol
On any startup:
1. Read `output/checkpoints/state.json`. If the file is missing or unparseable, start from step 0.
2. Find the highest step where `status: complete`. Resume from the **next** step.
3. Verify required checkpoint artifacts exist for the resumed step (see table below). If an artifact is missing, re-run the step that produces it.
4. **Never re-run a completed step** unless explicitly instructed by the user.

Required checkpoint artifacts per step:
| Step | Required Artifact |
|---|---|
| 2 | `output/train_clean.csv`, `output/test_clean.csv` |
| 2b | `output/train_resampled.csv` (or `resampling_strategy = class_weight_only` recorded in state.json) |
| 3 | `output/train_features.csv`, `output/test_features.csv` |
| 3b | `output/train_features_dfs.csv`, `output/test_features_dfs.csv` (only if multiple related tables exist) |
| 3c | `output/caafe_features.py`, updated `output/train_features.csv` (only if CAAFE conditions met) |
| 5 | `output/candidate_scores.md` |
| 6 | `output/solution_v1.py` |
| 8 | `output/solution_final.py` |
| 10 | `output/model_evaluation_report.md` |

## Decision Rules (follow strictly)
| Situation | Action |
|---|---|
| Task type unknown | Ask one question; do not proceed without answer |
| Primary metric not stated | Apply default from step 0 table; state explicitly |
| Compute budget unspecified | Default to 2 hours; announce at start |
| No test file in `./input/` | Set `no_test_set = true`; use OOF score as final proxy metric |
| Time-series task | Never shuffle rows; use time-ordered split everywhere |
| `n < 5 000` | Use 5-fold CV for all candidate evaluations; report mean ± std |
| Target column is constant | Halt immediately; report "Target column is constant — ML is not applicable." |
| `imbalanced = true` | Enable `class_weight='balanced'` or SMOTE in preprocessing and all candidates |
| `imbalanced = true` and task is classification | Invoke `resampling` skill in step 2b before feature engineering |
| `resampling` skill reports no improvement | Set `resampling_strategy = class_weight_only`; pass `class_weight='balanced'` to all candidates |
| `resampling` skill produces `output/train_resampled.csv` | Use it as training input in all downstream steps instead of `train_clean.csv` |
| `log_target = true` | Apply `log1p` to target at start; `expm1` inverse in postprocessing |
| `numeric_feature_count = 0` | Skip all scaling steps in preprocessing |
| Feature count > 1 000 after step 3 | Reduce to top 500 via variance-threshold + MI selection |
| Multiple related tables detected in `./input/` | Invoke `deep-feature-synthesis` in step 3b; merge DFS features into canonical feature set |
| DFS memory error | Reduce `max_depth` to 1; remove STD/MEDIAN/TREND primitives; retry |
| DFS feature matrix row count ≠ target entity rows | Stop step 3b; diagnose relationship direction; do not merge corrupt DFS output |
| Task is classification AND description available | Invoke `caafe` in step 3c |
| No dataset description available for CAAFE | Skip step 3c; log `CAAFE_SKIPPED_NO_DESCRIPTION` |
| CAAFE accepted 0 features | Log `CAAFE_NO_IMPROVEMENT`; continue with pre-CAAFE feature set |
| CAAFE feature code references target column | Reject that feature; flag leakage in report; continue |
| Remaining budget < time for 10 CAAFE iterations | Skip step 3c; log `CAAFE_SKIPPED_BUDGET` |
| `gpu_available = false` | Do not invoke NAS; set NAS budget to 0 |
| Estimated memory > 4 GB (rows × cols × 8 bytes) | Apply column subsampling to top-500 EDA features before any candidate run |
| Candidate data path set to `./input/` | Fix to load from `output/train_features.csv` before running |
| `score_parser` returns no score | Treat as script failure; apply 3-debug-attempt rule |
| Data leakage detected | Stop; fix; re-run checker; do not advance until clean |
| Leakage check runner fails | Manually audit the preprocessing block using the checker prompt |
| Candidate fails after 3 debug attempts | Discard; proceed with remaining candidates |
| Fewer than 3 candidates remain after discards | Halt pipeline; report failure; recommend manual model selection |
| Merged solution worse than best single | Keep best single as `solution_v1.py`; log `MERGE_FAILED` |
| Refinement < 0.001 for 3 consecutive cycles | Stop loop; advance to step 8 |
| Remaining budget < 20% | Skip remaining refinement cycles; go directly to step 8 |
| Sub-step projected to exceed remaining budget | Skip that sub-step; log `SKIPPED_BUDGET` |
| All improved solutions are same algorithm family | Skip stacking; use weighted average ensemble only |
| Ensemble worse than best single | Use best single; log `ENSEMBLE_FAILED` |
| No improved solutions after full refinement | Report plateau; recommend: more data, different features, or different model family |
| `n > 30 000` for intermediate scripts | Subsample to 30 000; use full data only for final solution |
| Pipeline crashes mid-run | Resume from last completed checkpoint in `output/checkpoints/state.json` |
| Tuned script beats current best | Promote `solution_vN_tuned.py` as new current best; update checkpoint |
| Duplicate column names after feature engineering | Rename with `_1`, `_2` suffixes; log count; continue |

> **Script invocation note**: The skills jar is on `PYTHONPATH`. All scripts must be invoked as Python modules: `python3 -m ioa.agent.analyst.skills.automl.scripts.<script_name>`.

## Guardrails
- **NEVER** use test data for training, tuning, or model selection — only for the final evaluation in step 10.
- **NEVER** proceed past step 2 if data leakage is unresolved.
- **NEVER** shuffle rows for time-series tasks — any split must be time-ordered.
- **NEVER** remove subsampling from intermediate scripts.
- **NEVER** use `exit()`, `try/except`, or `if/else` to suppress errors in solution scripts.
- **NEVER** ensemble a solution that failed the leakage check.
- **NEVER** declare the pipeline complete without a final evaluation (step 10), even if `no_test_set = true`.
- **NEVER** invoke NAS if `gpu_available = false`.
- **NEVER** apply Platt scaling to regression tasks.
- **NEVER** apply resampling to the test set or to non-classification tasks — the `resampling` skill enforces this, but verify.
- **NEVER** run `ft.dfs()` to generate test features in DFS — always use `ft.calculate_feature_matrix(feature_defs, ...)` with saved definitions.
- **NEVER** run CAAFE without a dataset description — the generated features will be non-semantic.
- **NEVER** use CAAFE-generated features that reference the target column — inspect `output/caafe_features.py` before promoting.
- **NEVER** apply resampling to the test set or to non-classification tasks — the `resampling` skill enforces this, but verify.
- **ALWAYS** run leakage + usage checks after every new or modified solution script.
- **ALWAYS** update `output/checkpoints/state.json` after each step completes.
- **ALWAYS** save `output/requirements_final.txt` and `final/submission.csv`.
- **ALWAYS** load training data from `output/train_features.csv` in candidate and solution scripts — not from `./input/`.

## Examples
- *"Build a complete ML pipeline for `train.csv` to predict customer churn — maximize AUC-ROC within 2 hours."*
- *"Run AutoML on this tabular regression dataset (`house_prices.csv`) and minimize RMSE."*
- *"Automate the ML workflow for my fraud detection dataset — I need F1 > 0.85 on the test set."*
- *"Run end-to-end AutoML on `medical_records.csv` for multi-class disease classification."*
- *"Find the best model for this time-series sales forecasting problem automatically."*
- *"I have only 2 000 labelled samples — can you build the best possible model with cross-validation?"*
- *"Cluster my customer dataset and find the optimal number of segments."*
- *"I have a training file but no separate test file — build the best model you can."*

## Output Contract
The final deliverable is:
1. `final/submission.csv` — test predictions (or cluster assignments) in the required format.
2. `output/solution_final.py` — complete, runnable winning solution with fixed random seed (`RANDOM_SEED = 42`).
3. `output/requirements_final.txt` — pinned library versions for reproducibility.
4. `output/automl_report.md` — pipeline report with all 8 sections (steps 0–10 checklist).
5. `output/model_evaluation_report.md` — from the `model-evaluation` skill (or OOF proxy report if no test set).
6. A brief in-chat summary: final test metric (or OOF proxy), improvement % over baseline, ensemble composition, top-3 insights.
7. `output/final_metrics.json` — a structured machine-readable summary for downstream tools. Emit it as the LAST step by running:

   ```
   python3 -m ioa.agent.analyst.skills.automl.scripts.emit_final_metrics
   ```

   This reads `output/checkpoints/state.json` and `output/automl_report.md` and writes the headline numbers (`task_type`, `primary_metric`, OOF/test scores, `rows`, `cv`, `ensemble_method`) as JSON. Run it after the report is written so all scores are recorded; never hand-author this file.
