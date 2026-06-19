/*
 * Copyright (c) 2010-2026 Haifeng Li. All rights reserved.
 *
 * SMILE Serve is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * SMILE Serve is distributed in the hope that it will be useful,
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with SMILE. If not, see <https://www.gnu.org/licenses/>.
 */
package smile.daemon;

import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import smile.daemon.DaemonMessage.*;

/**
 * A {@link RunSource} that replays a representative churn-prediction AutoML Run over
 * the real protocol, pausing at a Clarify gate for human input. This is the bundled
 * implementation because Clair's {@code automl} agent skill (the real engine, ADR-0005)
 * ships in the {@code ioa-agent} jar that is absent from this repository and needs LLM
 * credentials to run. The message sequence mirrors the frontend mock so behavior is
 * identical from either source; the agent-backed {@link RunSource} replaces this class
 * without changing the transport or the frontend.
 *
 * @author Haifeng Li
 */
public class ScriptedRunSource implements RunSource {
    private static final String RUN_ID = "run-churn-001";
    private final long stepMillis;

    /** @param stepMillis delay between emissions; 0 for tests. */
    public ScriptedRunSource(long stepMillis) {
        this.stepMillis = stepMillis;
    }

    private void pace() {
        if (stepMillis > 0) {
            try {
                Thread.sleep(stepMillis);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private Stage stage(String id, String label, StageStatus status, String detail, List<String> refs) {
        return new Stage(id, label, status, refs, detail);
    }

    @Override
    public void run(Consumer<DaemonMessage> emit, RunControl control) {
        List<Stage> stages = List.of(
            stage("eda", "Exploratory Data Analysis", StageStatus.pending, null, List.of()),
            stage("preprocess", "Preprocessing", StageStatus.pending, null, List.of()),
            stage("leakage", "Data Leakage Check", StageStatus.pending, null, List.of()),
            stage("features", "Feature Engineering", StageStatus.pending, null, List.of()),
            stage("candidates", "Candidate Research & Evaluation", StageStatus.pending, null, List.of()),
            stage("refine", "Iterative Refinement", StageStatus.pending, null, List.of()),
            stage("ensemble", "Ensemble", StageStatus.pending, null, List.of()),
            stage("evaluate", "Final Evaluation", StageStatus.pending, null, List.of()),
            stage("report", "Report", StageStatus.pending, null, List.of())
        );

        emit.accept(new RunStarted(RUN_ID, "Predict customer churn from telco.csv", stages));
        pace();

        // Clarify gate — the skill "asks once" for the primary metric (ADR-0010).
        emit.accept(new AgentChunk(RUN_ID, "I'll build a churn classifier. Before I start, one quick question.\n"));
        Question q = new Question("q-metric", "Confirm the primary metric",
                "What is the primary metric to optimize?",
                List.of("AUC (recommended)", "F1", "Accuracy"), false);
        emit.accept(new GateOpened(RUN_ID, new Gate("g-metric", "clarify", "Confirm the primary metric", q)));
        boolean answered = control.awaitGate("g-metric").isPresent();
        emit.accept(new GateClosed(RUN_ID, "g-metric"));
        if (!answered || control.isCancelled()) {
            emit.accept(new RunFinished(RUN_ID, "cancelled"));
            return;
        }
        emit.accept(new AgentChunk(RUN_ID, "Optimizing AUC. Starting the pipeline.\n\n"));
        pace();

        // EDA
        emit.accept(new StageProgress(RUN_ID, stage("eda", "Exploratory Data Analysis", StageStatus.running, null, List.of())));
        emit.accept(new ToolCallMsg(RUN_ID, new ToolCall("tc-eda", "Skill: exploratory-data-analysis", "skill", "done",
                null, "Profiled 21 features over 7,043 rows. Target churn rate 26.5%.", null)));
        emit.accept(new ArtifactMsg(RUN_ID, new Artifact("eda_report", "report", "EDA Report",
                "# EDA Report\n\n- **Rows:** 7,043  **Features:** 21\n- **Target:** `Churn` (binary), positive rate **26.5%**\n- **Top predictors:** `tenure`, `Contract`, `MonthlyCharges`\n",
                null, null, null)));
        emit.accept(new StageProgress(RUN_ID, stage("eda", "Exploratory Data Analysis", StageStatus.done, "21 features profiled", List.of("eda_report"))));
        pace();

        // Preprocess + leakage
        emit.accept(new StageProgress(RUN_ID, stage("preprocess", "Preprocessing", StageStatus.running, null, List.of())));
        emit.accept(new ToolCallMsg(RUN_ID, new ToolCall("tc-pre", "Skill: preprocess", "skill", "done",
                null, "Imputed TotalCharges, one-hot encoded 16 categoricals, standardized 3 numerics.", null)));
        emit.accept(new StageProgress(RUN_ID, stage("preprocess", "Preprocessing", StageStatus.done, "cleaned + encoded", List.of())));
        emit.accept(new StageProgress(RUN_ID, stage("leakage", "Data Leakage Check", StageStatus.running, null, List.of())));
        emit.accept(new ToolCallMsg(RUN_ID, new ToolCall("tc-leak", "Ran leakage_check_runner.py", "script", "done",
                "python3 -m ...automl.scripts.leakage_check_runner", "{ \"leakage_status\": \"No Data Leakage\" }", "No leakage")));
        emit.accept(new StageProgress(RUN_ID, stage("leakage", "Data Leakage Check", StageStatus.done, "No data leakage", List.of())));
        pace();

        // Features
        emit.accept(new StageProgress(RUN_ID, stage("features", "Feature Engineering", StageStatus.running, null, List.of())));
        emit.accept(new ToolCallMsg(RUN_ID, new ToolCall("tc-feat", "Skill: feature-engineering", "skill", "done",
                null, "21 -> 38 features (interactions, tenure buckets).", null)));
        emit.accept(new StageProgress(RUN_ID, stage("features", "Feature Engineering", StageStatus.done, "38 features", List.of())));
        pace();

        // Candidate evaluation
        emit.accept(new StageProgress(RUN_ID, stage("candidates", "Candidate Research & Evaluation", StageStatus.running, null, List.of())));
        emit.accept(new AgentChunk(RUN_ID, "Researching and evaluating candidate models…\n"));
        String[][] cands = {
            {"tc-c1", "Ran candidate_logreg.py", "AUC 0.842"},
            {"tc-c2", "Ran candidate_rf.py", "AUC 0.881"},
            {"tc-c3", "Ran candidate_mlp.py", "AUC 0.902"},
            {"tc-c4", "Ran candidate_xgb.py", "AUC 0.908"},
            {"tc-c5", "Ran candidate_lgbm.py", "AUC 0.913"},
        };
        for (String[] c : cands) {
            emit.accept(new ToolCallMsg(RUN_ID, new ToolCall(c[0], c[1], "script", "done",
                    null, "Final Validation Performance: " + c[2].substring(4), c[2])));
            pace();
        }
        String leaderboardMd = """
                | Candidate | Val Score | Std (CV) | Params | Runtime (s) | Notes |
                |---|---|---|---|---|---|
                | candidate_lgbm | 0.913 | 0.008 | n_estimators=500, lr=0.05 | 42 | gradient boosting |
                | candidate_xgb | 0.908 | 0.009 | max_depth=6 | 51 | gradient boosting |
                | candidate_mlp | 0.902 | 0.014 | ReLU(128) | 88 | neural net |
                | candidate_rf | 0.881 | 0.011 | trees=500 | 31 | random forest |
                | candidate_logreg | 0.842 | 0.010 | C=1.0 | 6 | linear baseline |""";
        emit.accept(new ArtifactMsg(RUN_ID, new Artifact("leaderboard", "leaderboard", "Leaderboard",
                leaderboardMd, null, null, null)));
        emit.accept(new StageProgress(RUN_ID, stage("candidates", "Candidate Research & Evaluation", StageStatus.done, "5 candidates evaluated", List.of("leaderboard"))));
        pace();

        // Refine + ensemble
        emit.accept(new StageProgress(RUN_ID, stage("refine", "Iterative Refinement", StageStatus.running, null, List.of())));
        emit.accept(new ToolCallMsg(RUN_ID, new ToolCall("tc-ref", "Ablation + tuning on candidate_lgbm", "script", "done",
                null, "Tuned: AUC 0.913 -> 0.918", "AUC 0.918")));
        emit.accept(new StageProgress(RUN_ID, stage("refine", "Iterative Refinement", StageStatus.done, "best AUC 0.918", List.of())));
        emit.accept(new StageProgress(RUN_ID, stage("ensemble", "Ensemble", StageStatus.running, null, List.of())));
        emit.accept(new ToolCallMsg(RUN_ID, new ToolCall("tc-ens", "Hill-climbing ensemble (lgbm + xgb + mlp)", "script", "done",
                null, "Ensemble AUC 0.924 (beats best single 0.918)", "AUC 0.924")));
        emit.accept(new StageProgress(RUN_ID, stage("ensemble", "Ensemble", StageStatus.done, "AUC 0.924", List.of())));
        pace();

        // Final evaluation — charts
        emit.accept(new StageProgress(RUN_ID, stage("evaluate", "Final Evaluation", StageStatus.running, null, List.of())));
        emit.accept(new ArtifactMsg(RUN_ID, new Artifact("roc", "chart", "ROC Curve", null,
                new DataVizSpec("line", "ROC (test AUC 0.921)", Map.of("x", "fpr", "y", "tpr"),
                        new ArrowRef("arrow", "arrow-roc", null, null)), null, null)));
        emit.accept(new ArtifactMsg(RUN_ID, new Artifact("shap", "chart", "Feature Importance (SHAP)", null,
                new DataVizSpec("bar", "Top features by SHAP", Map.of("x", "importance", "y", "feature"),
                        new ArrowRef("arrow", "arrow-shap", null, null)), null, null)));
        emit.accept(new StageProgress(RUN_ID, stage("evaluate", "Final Evaluation", StageStatus.done, "test AUC 0.921", List.of("roc", "shap"))));
        pace();

        // Report
        emit.accept(new StageProgress(RUN_ID, stage("report", "Report", StageStatus.running, null, List.of())));
        emit.accept(new ArtifactMsg(RUN_ID, new Artifact("report", "report", "AutoML Report",
                "# AutoML Report\n\n## Final Performance\nTest **AUC 0.921** (ensemble) vs baseline 0.842 — **+9.4%**.\n\n## Final Solution\nHill-climbing ensemble: LightGBM + XGBoost + MLP, seed 42.\n",
                null, null, null)));
        emit.accept(new StageProgress(RUN_ID, stage("report", "Report", StageStatus.done, "report ready", List.of("report"))));
        emit.accept(new RunFinished(RUN_ID, "completed"));
    }
}
