/**
 * Mock daemon (V0): a scripted sequence of DaemonMessages replaying a complete
 * churn-prediction AutoML Run over the real protocol (ADR-0002/0006). The real JVM
 * daemon will emit this same message stream; the UI cannot tell them apart.
 */
import type { DaemonMessage, StageProgress } from "../protocol";

const RUN_ID = "run-churn-001";

const STAGES: StageProgress[] = [
  { stageId: "eda", label: "Exploratory Data Analysis", status: "pending", artifactRefs: [] },
  { stageId: "preprocess", label: "Preprocessing", status: "pending", artifactRefs: [] },
  { stageId: "leakage", label: "Data Leakage Check", status: "pending", artifactRefs: [] },
  { stageId: "features", label: "Feature Engineering", status: "pending", artifactRefs: [] },
  { stageId: "candidates", label: "Candidate Research & Evaluation", status: "pending", artifactRefs: [] },
  { stageId: "refine", label: "Iterative Refinement", status: "pending", artifactRefs: [] },
  { stageId: "ensemble", label: "Ensemble", status: "pending", artifactRefs: [] },
  { stageId: "evaluate", label: "Final Evaluation", status: "pending", artifactRefs: [] },
  { stageId: "report", label: "Report", status: "pending", artifactRefs: [] },
];

function stage(stageId: string, status: StageProgress["status"], detail?: string, artifactRefs: string[] = []): DaemonMessage {
  const base = STAGES.find((s) => s.stageId === stageId)!;
  return {
    type: "stage-progress",
    runId: RUN_ID,
    stage: { ...base, status, detail, artifactRefs },
  };
}

const LEADERBOARD_MD = `
| Candidate | Val Score | Std (CV) | Params | Runtime (s) | Notes |
|---|---|---|---|---|---|
| candidate_lgbm | 0.913 | 0.008 | n_estimators=500, lr=0.05 | 42 | gradient boosting |
| candidate_xgb | 0.908 | 0.009 | max_depth=6 | 51 | gradient boosting |
| candidate_mlp | 0.902 | 0.014 | ReLU(128)|ReLU(64) | 88 | neural net |
| candidate_rf | 0.881 | 0.011 | trees=500 | 31 | random forest |
| candidate_logreg | 0.842 | 0.010 | C=1.0 | 6 | linear baseline |
`.trim();

/** The full scripted run, in emission order. */
export const churnRunScript: DaemonMessage[] = [
  { type: "run-started", runId: RUN_ID, goal: "Predict customer churn from telco.csv", stages: STAGES },
  { type: "turn-started", turnId: "agent-turn-1", role: "agent" },

  // Clarify gate — the skill "asks once" for the primary metric.
  { type: "agent-chunk", runId: RUN_ID, text: "I'll build a churn classifier. Before I start, one quick question.\n" },
  { type: "gate-opened", runId: RUN_ID, gate: { id: "g-metric", kind: "clarify", prompt: "Confirm the primary metric", question: { id: "q-metric", prompt: "What is the primary metric to optimize?", options: ["AUC (recommended)", "F1", "Accuracy"] } } },
  { type: "gate-closed", runId: RUN_ID, gateId: "g-metric" },
  { type: "agent-chunk", runId: RUN_ID, text: "Optimizing AUC. Starting the pipeline.\n\n" },

  // EDA
  stage("eda", "running"),
  { type: "tool-call", runId: RUN_ID, call: { id: "tc-eda", title: "Skill: exploratory-data-analysis", kind: "skill", status: "running" } },
  { type: "tool-call", runId: RUN_ID, call: { id: "tc-eda", title: "Skill: exploratory-data-analysis", kind: "skill", status: "done", output: "Profiled 21 features over 7,043 rows. Target churn rate 26.5%. No constant columns." } },
  { type: "artifact", runId: RUN_ID, artifact: { ref: "eda_report", kind: "report", title: "EDA Report", body: "# EDA Report\n\n- **Rows:** 7,043  **Features:** 21\n- **Target:** `Churn` (binary), positive rate **26.5%** — mild imbalance\n- **Top predictors:** `tenure`, `Contract`, `MonthlyCharges`\n- **Data quality:** 11 missing `TotalCharges`, no duplicates\n" } },
  { type: "artifact", runId: RUN_ID, artifact: { ref: "corr_heatmap", kind: "chart", title: "Correlation Heatmap", viz: { type: "heatmap", title: "Feature correlation", encodings: { x: "feature_x", y: "feature_y", value: "corr" }, dataRef: { kind: "arrow", ref: "arrow-corr" } } } },
  stage("eda", "done", "21 features profiled", ["eda_report", "corr_heatmap"]),

  // Preprocess + leakage gate
  stage("preprocess", "running"),
  { type: "tool-call", runId: RUN_ID, call: { id: "tc-pre", title: "Skill: preprocess", kind: "skill", status: "done", output: "Imputed TotalCharges, one-hot encoded 16 categoricals, standardized 3 numerics." } },
  stage("preprocess", "done", "cleaned + encoded"),
  stage("leakage", "running"),
  { type: "tool-call", runId: RUN_ID, call: { id: "tc-leak", title: "Ran leakage_check_runner.py", kind: "script", status: "done", score: "No leakage", code: "python3 -m ...automl.scripts.leakage_check_runner", output: '{ "leakage_status": "No Data Leakage" }' } },
  stage("leakage", "done", "No data leakage"),

  // Feature engineering
  stage("features", "running"),
  { type: "tool-call", runId: RUN_ID, call: { id: "tc-feat", title: "Skill: feature-engineering", kind: "skill", status: "done", output: "21 -> 38 features (interactions, tenure buckets)." } },
  stage("features", "done", "38 features"),

  // Candidate evaluation — several scripts, then the leaderboard artifact
  stage("candidates", "running"),
  { type: "agent-chunk", runId: RUN_ID, text: "Researching and evaluating candidate models…\n" },
  { type: "tool-call", runId: RUN_ID, call: { id: "tc-c1", title: "Ran candidate_logreg.py", kind: "script", status: "done", score: "AUC 0.842", output: "Final Validation Performance: 0.842" } },
  { type: "tool-call", runId: RUN_ID, call: { id: "tc-c2", title: "Ran candidate_rf.py", kind: "script", status: "done", score: "AUC 0.881", output: "Final Validation Performance: 0.881" } },
  { type: "tool-call", runId: RUN_ID, call: { id: "tc-c3", title: "Ran candidate_mlp.py", kind: "script", status: "done", score: "AUC 0.902", output: "Final Validation Performance: 0.902" } },
  { type: "tool-call", runId: RUN_ID, call: { id: "tc-c4", title: "Ran candidate_xgb.py", kind: "script", status: "done", score: "AUC 0.908", output: "Final Validation Performance: 0.908" } },
  { type: "tool-call", runId: RUN_ID, call: { id: "tc-c5", title: "Ran candidate_lgbm.py", kind: "script", status: "done", score: "AUC 0.913", output: "Final Validation Performance: 0.913" } },
  { type: "artifact", runId: RUN_ID, artifact: { ref: "leaderboard", kind: "leaderboard", title: "Leaderboard", body: LEADERBOARD_MD } },
  stage("candidates", "done", "5 candidates evaluated", ["leaderboard"]),

  // Refinement
  stage("refine", "running"),
  { type: "tool-call", runId: RUN_ID, call: { id: "tc-ref", title: "Ablation + tuning on candidate_lgbm", kind: "script", status: "done", score: "AUC 0.918", output: "Tuned: AUC 0.913 -> 0.918" } },
  stage("refine", "done", "best AUC 0.918"),

  // Ensemble
  stage("ensemble", "running"),
  { type: "tool-call", runId: RUN_ID, call: { id: "tc-ens", title: "Hill-climbing ensemble (lgbm + xgb + mlp)", kind: "script", status: "done", score: "AUC 0.924", output: "Ensemble AUC 0.924 (beats best single 0.918)" } },
  stage("ensemble", "done", "AUC 0.924"),

  // Final evaluation — ROC + confusion + SHAP charts
  stage("evaluate", "running"),
  { type: "artifact", runId: RUN_ID, artifact: { ref: "roc", kind: "chart", title: "ROC Curve", viz: { type: "line", title: "ROC (test AUC 0.921)", encodings: { x: "fpr", y: "tpr" }, dataRef: { kind: "arrow", ref: "arrow-roc" } } } },
  { type: "artifact", runId: RUN_ID, artifact: { ref: "confusion", kind: "chart", title: "Confusion Matrix", viz: { type: "heatmap", title: "Confusion matrix", encodings: { x: "predicted", y: "actual", value: "count" }, dataRef: { kind: "arrow", ref: "arrow-confusion" } } } },
  { type: "artifact", runId: RUN_ID, artifact: { ref: "shap", kind: "chart", title: "Feature Importance (SHAP)", viz: { type: "bar", title: "Top features by SHAP", encodings: { x: "importance", y: "feature" }, dataRef: { kind: "arrow", ref: "arrow-shap" } } } },
  stage("evaluate", "done", "test AUC 0.921", ["roc", "confusion", "shap"]),

  // Report
  stage("report", "running"),
  { type: "artifact", runId: RUN_ID, artifact: { ref: "report", kind: "report", title: "AutoML Report", body: "# AutoML Report\n\n## Final Performance\nTest **AUC 0.921** (ensemble) vs baseline 0.842 — **+9.4%**.\n\n## Final Solution\nHill-climbing ensemble: LightGBM + XGBoost + MLP, seed 42.\n\n## Key Insights\n1. `Contract` and `tenure` dominate churn risk.\n2. Month-to-month contracts drive most positive predictions.\n3. Tuning added +0.5% AUC; ensembling added +0.6%.\n" } },
  stage("report", "done", "report ready", ["report"]),

  { type: "turn-finished", turnId: "agent-turn-1", status: "done" },
  { type: "run-finished", runId: RUN_ID, status: "completed" },
];

export { RUN_ID as churnRunId };
