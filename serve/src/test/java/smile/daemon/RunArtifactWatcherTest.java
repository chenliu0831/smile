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

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Verifies the watcher seeds the pipeline timeline and emits a stage + artifact when an
 * automl output file appears.
 *
 * @author Haifeng Li
 */
public class RunArtifactWatcherTest {

    @Test
    public void backfillsSkippedEarlyStagesAndAcceptsVariantFilenames(@TempDir Path dir) throws Exception {
        // Reproduces a real agent run that did EDA INLINE (no output/eda_report.md), named the
        // leaderboard `leaderboard.csv` (not candidate_scores.md), skipped train_clean.csv, and
        // finished with final/submission.csv. The timeline must NOT strand on EDA.
        var msgs = new CopyOnWriteArrayList<DaemonMessage>();
        var watcher = new RunArtifactWatcher("s1", dir, msgs::add);
        watcher.start();
        waitFor(() -> msgs.stream().anyMatch(m -> m instanceof DaemonMessage.RunStarted), 2000);

        Files.createDirectories(dir.resolve("output"));
        Files.createDirectories(dir.resolve("final"));
        Files.writeString(dir.resolve("output/train_features.csv"), "a,b\n1,2\n");          // features (variant of preprocess too)
        Files.writeString(dir.resolve("output/leaderboard.csv"), "model,auc\nrf,0.88\n");   // candidates VARIANT
        Files.writeString(dir.resolve("output/solution_final.py"), "print('x')\n");          // solution
        Files.writeString(dir.resolve("final/submission.csv"), "id,pred\n1,0\n");            // submission (last stage)

        // All stages up to submission should end 'done' — including EDA (backfilled) and
        // preprocess (skipped), even though eda_report.md / train_clean.csv never existed.
        waitFor(() -> latestStatus(msgs, "submission") == DaemonMessage.StageStatus.done, 5000);
        waitFor(() -> latestStatus(msgs, "eda") == DaemonMessage.StageStatus.done, 2000);
        assertEquals(DaemonMessage.StageStatus.done, latestStatus(msgs, "eda"), "EDA must backfill to done, not strand at running");
        assertEquals(DaemonMessage.StageStatus.done, latestStatus(msgs, "preprocess"), "skipped preprocess must backfill to done");
        assertEquals(DaemonMessage.StageStatus.done, latestStatus(msgs, "candidates"), "leaderboard.csv variant marks candidates done");

        // The candidates stage still emits a leaderboard artifact (from the variant file).
        assertTrue(msgs.stream().anyMatch(m -> m instanceof DaemonMessage.ArtifactMsg a
                && a.artifact().ref().equals("candidates") && a.artifact().kind().equals("leaderboard")),
                "leaderboard artifact emitted from the variant filename");

        watcher.stop();
    }

    @Test
    public void prefersRealContentOverAStubCanonicalFile(@TempDir Path dir) throws Exception {
        // The agent wrote a 25-byte stub `candidate_scores.md` but the real 9-model table in
        // `leaderboard.csv`. The candidates artifact must carry the REAL data, not the stub.
        // Write BOTH files before the watcher's first scan so the stub-skip (not poll timing)
        // is what's under test: a stub canonical file alongside a richer variant.
        Files.createDirectories(dir.resolve("output"));
        Files.writeString(dir.resolve("output/candidate_scores.md"), "# Candidate Leaderboard\n\n"); // 25-byte stub
        // A realistically-sized CSV (well over the stub threshold), as real runs produce.
        String realCsv = "model,auc,auc_std,acc,f1,runtime_s\n"
            + "rf,0.8848224842616559,0.01959864013431618,0.8383838383838383,0.7811550151975684,2.16\n"
            + "xgb,0.8833098989124298,0.024076775407834587,0.8271604938271605,0.7694610778443114,1.19\n"
            + "logreg,0.8711293260473589,0.02036794410472825,0.8327721661054994,0.7792592592592592,2.18\n";
        Files.writeString(dir.resolve("output/leaderboard.csv"), realCsv);

        var msgs = new CopyOnWriteArrayList<DaemonMessage>();
        var watcher = new RunArtifactWatcher("s1", dir, msgs::add);
        watcher.start();
        waitFor(() -> msgs.stream().anyMatch(m -> m instanceof DaemonMessage.RunStarted), 2000);

        waitFor(() -> msgs.stream().anyMatch(m -> m instanceof DaemonMessage.ArtifactMsg a
                && a.artifact().ref().equals("candidates")), 4000);
        var art = msgs.stream()
                .filter(m -> m instanceof DaemonMessage.ArtifactMsg)
                .map(m -> ((DaemonMessage.ArtifactMsg) m).artifact())
                .filter(a -> a.ref().equals("candidates")).findFirst().orElseThrow();
        assertEquals("leaderboard", art.kind());
        assertNotNull(art.body());
        assertTrue(art.body().contains("model,auc"), "candidates artifact must carry the real leaderboard.csv, not the stub");
        assertTrue(art.body().contains("rf,0.884"), "real model rows present");

        watcher.stop();
    }

    @Test
    public void summaryMdIsTheReportNotEdaAndNotDoubleSurfaced(@TempDir Path dir) throws Exception {
        // The automl `summary.md` (cwd root) is the FINAL run summary, not an EDA report.
        // It must surface as the report stage (when no automl_report.md), never as EDA, and
        // never ALSO as a freeform "Data Summary" duplicate during an automl run.
        Files.createDirectories(dir.resolve("output"));
        Files.writeString(dir.resolve("output/train_features.csv"), "a\n1\n");              // an automl stage → run underway
        Files.writeString(dir.resolve("summary.md"), "# Titanic AutoML — Summary\n\nFinal model: ensemble, OOF AUC 0.8876.\n");

        var msgs = new CopyOnWriteArrayList<DaemonMessage>();
        var watcher = new RunArtifactWatcher("s1", dir, msgs::add);
        watcher.start();
        waitFor(() -> latestStatus(msgs, "report") == DaemonMessage.StageStatus.done, 5000);

        var reportArtifacts = msgs.stream()
                .filter(m -> m instanceof DaemonMessage.ArtifactMsg)
                .map(m -> ((DaemonMessage.ArtifactMsg) m).artifact())
                .filter(a -> a.body() != null && a.body().contains("Titanic AutoML — Summary"))
                .toList();
        // Exactly ONE artifact carries summary.md's content, and it's the report (not EDA, not freeform).
        assertEquals(1, reportArtifacts.size(), "summary.md must surface exactly once (no freeform duplicate)");
        assertEquals("report", reportArtifacts.get(0).ref());
        assertEquals("AutoML Report", reportArtifacts.get(0).title());
        // The EDA artifact (if any) must NOT carry the final-summary content.
        assertFalse(msgs.stream().anyMatch(m -> m instanceof DaemonMessage.ArtifactMsg a
                && a.artifact().ref().equals("eda")
                && a.artifact().body() != null && a.artifact().body().contains("Final model")),
                "summary.md must never be shown as the EDA report");

        watcher.stop();
    }

    @Test
    public void suppressesDuplicatePngsAndSurfacesCsvsAsDataframes(@TempDir Path dir) throws Exception {
        var msgs = new CopyOnWriteArrayList<DaemonMessage>();
        var watcher = new RunArtifactWatcher("s1", dir, msgs::add);
        watcher.start();
        waitFor(() -> msgs.stream().anyMatch(m -> m instanceof DaemonMessage.RunStarted), 2000);

        Files.createDirectories(dir.resolve("output"));
        // PNGs: ones that duplicate a native surface (suppressed) + one that doesn't (kept).
        for (String png : new String[] {"roc_curve.png", "confusion_matrix.png",
                "feature_importance.png", "leaderboard.png", "calibration.png"}) {
            Files.write(dir.resolve(png), new byte[]{(byte)0x89, 'P', 'N', 'G'}); // tiny PNG-ish
        }
        // CSVs: surfaced ones + the two excluded (already have interactive surfaces).
        Files.writeString(dir.resolve("output/feature_importance.csv"), "feature,importance\nSex,0.21\n");
        Files.writeString(dir.resolve("output/leaderboard.csv"), "model,auc\nrf,0.88\n");      // excluded (interactive Leaderboard)
        Files.writeString(dir.resolve("output/oof_final.csv"), "PassengerId,y,oof_prob\n1,0,0.1\n"); // excluded (Predictions Studio)

        // Let a few poll ticks run.
        Thread.sleep(2500);

        var imageNames = msgs.stream()
                .filter(m -> m instanceof DaemonMessage.ArtifactMsg)
                .map(m -> ((DaemonMessage.ArtifactMsg) m).artifact())
                .filter(a -> a.kind().equals("image"))
                .map(a -> a.path() == null ? "" : a.path())
                .toList();
        // Duplicate-of-native PNGs must NOT surface; calibration (no native equiv) must.
        assertTrue(imageNames.stream().anyMatch(p -> p.endsWith("calibration.png")), "calibration.png kept");
        assertTrue(imageNames.stream().noneMatch(p -> p.endsWith("roc_curve.png")), "roc_curve.png suppressed");
        assertTrue(imageNames.stream().noneMatch(p -> p.endsWith("confusion_matrix.png")), "confusion_matrix.png suppressed");
        assertTrue(imageNames.stream().noneMatch(p -> p.endsWith("feature_importance.png")), "feature_importance.png suppressed");
        assertTrue(imageNames.stream().noneMatch(p -> p.endsWith("leaderboard.png")), "leaderboard.png suppressed");

        var dfRefs = msgs.stream()
                .filter(m -> m instanceof DaemonMessage.ArtifactMsg)
                .map(m -> ((DaemonMessage.ArtifactMsg) m).artifact())
                .filter(a -> a.kind().equals("dataframe"))
                .map(DaemonMessage.Artifact::ref)
                .toList();
        // feature_importance.csv surfaces as a dataframe; leaderboard/oof_final do NOT (excluded).
        assertTrue(dfRefs.contains("df:feature_importance"), "feature_importance.csv surfaced as a dataframe grid");
        assertTrue(dfRefs.stream().noneMatch(r -> r.equals("df:leaderboard")), "leaderboard.csv NOT double-surfaced as a grid");
        assertTrue(dfRefs.stream().noneMatch(r -> r.equals("df:oof_final")), "oof_final.csv NOT double-surfaced as a grid");

        watcher.stop();
    }

    /** The latest status emitted for a given stage id, or null if none. */
    private static DaemonMessage.StageStatus latestStatus(java.util.List<DaemonMessage> msgs, String stageId) {
        return msgs.stream()
                .filter(m -> m instanceof DaemonMessage.StageProgress)
                .map(m -> ((DaemonMessage.StageProgress) m).stage())
                .filter(s -> s.stageId().equals(stageId))
                .reduce((a, b) -> b)
                .map(DaemonMessage.Stage::status)
                .orElse(null);
    }

    @Test
    public void seedsTimelineAndAnnouncesArtifactWhenFileAppears(@TempDir Path dir) throws Exception {
        var msgs = new CopyOnWriteArrayList<DaemonMessage>();
        var watcher = new RunArtifactWatcher("s1", dir, msgs::add);
        watcher.start();

        // Then: the timeline is seeded with all pending stages.
        waitFor(() -> msgs.stream().anyMatch(m -> m instanceof DaemonMessage.RunStarted), 2000);
        var seeded = msgs.stream()
                .filter(m -> m instanceof DaemonMessage.RunStarted)
                .map(m -> (DaemonMessage.RunStarted) m).findFirst().orElseThrow();
        assertTrue(seeded.stages().stream().anyMatch(s -> s.stageId().equals("eda")));
        assertTrue(seeded.stages().stream().allMatch(s -> s.status() == DaemonMessage.StageStatus.pending));

        // When: the EDA report appears.
        Files.createDirectories(dir.resolve("output"));
        Files.writeString(dir.resolve("output/eda_report.md"), "# EDA\n\n- rows: 120");

        // Then: a done stage-progress AND a report artifact for it are emitted.
        waitFor(() -> msgs.stream().anyMatch(m ->
                m instanceof DaemonMessage.ArtifactMsg a && "eda".equals(a.artifact().ref())), 4000);

        var stage = msgs.stream()
                .filter(m -> m instanceof DaemonMessage.StageProgress)
                .map(m -> ((DaemonMessage.StageProgress) m).stage())
                .filter(s -> s.stageId().equals("eda"))
                .reduce((a, b) -> b).orElseThrow();
        assertEquals(DaemonMessage.StageStatus.done, stage.status());

        var artifact = msgs.stream()
                .filter(m -> m instanceof DaemonMessage.ArtifactMsg)
                .map(m -> ((DaemonMessage.ArtifactMsg) m).artifact())
                .filter(a -> a.ref().equals("eda")).findFirst().orElseThrow();
        assertEquals("report", artifact.kind());
        assertTrue(artifact.body().contains("rows: 120"));

        watcher.stop();
    }

    @Test
    public void submissionBecomesAPredictionsDataframeArtifact(@TempDir Path dir) throws Exception {
        var msgs = new CopyOnWriteArrayList<DaemonMessage>();
        var watcher = new RunArtifactWatcher("s1", dir, msgs::add);
        watcher.start();
        waitFor(() -> msgs.stream().anyMatch(m -> m instanceof DaemonMessage.RunStarted), 2000);

        // When: the final prediction set appears.
        Files.createDirectories(dir.resolve("final"));
        Files.writeString(dir.resolve("final/submission.csv"),
                "PassengerId,Survived_proba,Survived_pred,Survived_actual\n1,0.9,1,1\n2,0.2,0,0\n");

        // Then: a `submission` artifact is announced.
        waitFor(() -> msgs.stream().anyMatch(m ->
                m instanceof DaemonMessage.ArtifactMsg a && "submission".equals(a.artifact().ref())), 4000);
        var art = msgs.stream()
                .filter(m -> m instanceof DaemonMessage.ArtifactMsg)
                .map(m -> ((DaemonMessage.ArtifactMsg) m).artifact())
                .filter(a -> a.ref().equals("submission")).findFirst().orElseThrow();

        // Predictions Studio rides the `dataframe` kind with a `data` ArrowRef naming the
        // materialized session table. When the shared DuckDB bridge is reachable, the
        // materialization succeeds and we get exactly that; when it is not (e.g. no agent
        // session in a unit test), the watcher degrades to the path-only `file` artifact —
        // the canvas still surfaces the submission. Assert whichever the environment yields.
        if ("dataframe".equals(art.kind())) {
            assertNotNull(art.data(), "dataframe artifact must carry a data ArrowRef");
            assertEquals("submission", art.data().ref());
            assertEquals("arrow", art.data().kind());
        } else {
            assertEquals("file", art.kind());
            assertNotNull(art.path());
            assertTrue(art.path().endsWith("submission.csv"));
        }

        watcher.stop();
    }

    @Test
    public void jsonSidecarBecomesAStructuredArtifactWithParsedMeta(@TempDir Path dir) throws Exception {
        var msgs = new CopyOnWriteArrayList<DaemonMessage>();
        var watcher = new RunArtifactWatcher("s1", dir, msgs::add);
        watcher.start();
        waitFor(() -> msgs.stream().anyMatch(m -> m instanceof DaemonMessage.RunStarted), 2000);

        // When: the postprocess sidecar appears (a skill-emitted public JSON output).
        Files.createDirectories(dir.resolve("output"));
        Files.writeString(dir.resolve("output/postprocess_results.json"),
                "{\"top5_features\":[{\"feature\":\"Title_Mr\",\"mean\":0.066,\"std\":0.018}]}");

        // Then: a `diagnostics` artifact is emitted with the parsed JSON inline in meta.
        waitFor(() -> msgs.stream().anyMatch(m ->
                m instanceof DaemonMessage.ArtifactMsg a && "diagnostics".equals(a.artifact().ref())), 4000);
        var art = msgs.stream()
                .filter(m -> m instanceof DaemonMessage.ArtifactMsg)
                .map(m -> ((DaemonMessage.ArtifactMsg) m).artifact())
                .filter(a -> a.ref().equals("diagnostics")).findFirst().orElseThrow();
        assertEquals("diagnostics", art.kind());
        assertNull(art.body(), "structured sidecars carry JSON in meta, not body");
        assertNotNull(art.meta(), "diagnostics artifact must carry parsed JSON in meta");
        // The daemon parsed the file to a JsonNode but did NOT interpret its schema.
        assertEquals(0.066, art.meta().get("top5_features").get(0).get("mean").asDouble(), 1e-9);

        watcher.stop();
    }

    @Test
    public void bestParamsBecomesAMetricsCompanionArtifact(@TempDir Path dir) throws Exception {
        var msgs = new CopyOnWriteArrayList<DaemonMessage>();
        var watcher = new RunArtifactWatcher("s1", dir, msgs::add);
        watcher.start();
        waitFor(() -> msgs.stream().anyMatch(m -> m instanceof DaemonMessage.RunStarted), 2000);

        Files.createDirectories(dir.resolve("output"));
        Files.writeString(dir.resolve("output/best_params.json"),
                "{\"xgb\":{\"params\":{\"max_depth\":5}}}");

        // The params companion uses kind "metrics" with ref "params" (joined into the
        // Leaderboard, not its own canvas tab), carrying the JSON inline in meta.
        waitFor(() -> msgs.stream().anyMatch(m ->
                m instanceof DaemonMessage.ArtifactMsg a && "params".equals(a.artifact().ref())), 4000);
        var art = msgs.stream()
                .filter(m -> m instanceof DaemonMessage.ArtifactMsg)
                .map(m -> ((DaemonMessage.ArtifactMsg) m).artifact())
                .filter(a -> a.ref().equals("params")).findFirst().orElseThrow();
        assertEquals("metrics", art.kind());
        assertNotNull(art.meta());
        assertEquals(5, art.meta().get("xgb").get("params").get("max_depth").asInt());

        watcher.stop();
    }

    @Test
    public void regeneratedReportReEmitsWithStableRef(@TempDir Path dir) throws Exception {
        var msgs = new CopyOnWriteArrayList<DaemonMessage>();
        var watcher = new RunArtifactWatcher("s1", dir, msgs::add);
        watcher.start();
        waitFor(() -> msgs.stream().anyMatch(m -> m instanceof DaemonMessage.RunStarted), 2000);

        Files.createDirectories(dir.resolve("output"));
        Path report = dir.resolve("output/automl_report.md");
        Files.writeString(report, "# Report v1\n## Recommended Next Steps\n1. Do X\n");

        // First emit of the report artifact.
        waitFor(() -> reportArtifacts(msgs).stream().anyMatch(a -> a.body() != null && a.body().contains("v1")), 4000);

        // Regenerate the report with new content + a later mtime.
        Files.setLastModifiedTime(report, java.nio.file.attribute.FileTime.fromMillis(System.currentTimeMillis() + 5000));
        Files.writeString(report, "# Report v2\n## Recommended Next Steps\n1. Do Y\n");

        // It re-emits with the SAME stable ref "report" (canvas replaces in place), new body.
        waitFor(() -> reportArtifacts(msgs).stream().anyMatch(a -> a.body() != null && a.body().contains("v2")), 4000);
        var reEmitted = reportArtifacts(msgs).stream()
                .filter(a -> a.body() != null && a.body().contains("v2")).findFirst().orElseThrow();
        assertEquals("report", reEmitted.ref());

        watcher.stop();
    }

    private static java.util.List<DaemonMessage.Artifact> reportArtifacts(java.util.List<DaemonMessage> msgs) {
        return msgs.stream()
                .filter(m -> m instanceof DaemonMessage.ArtifactMsg)
                .map(m -> ((DaemonMessage.ArtifactMsg) m).artifact())
                .filter(a -> a.ref().equals("report"))
                .toList();
    }

    private interface Cond { boolean ok(); }

    private void waitFor(Cond c, long timeoutMs) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
        while (System.nanoTime() < deadline) {
            if (c.ok()) return;
            Thread.sleep(25);
        }
        fail("condition not met within " + timeoutMs + "ms");
    }
}
