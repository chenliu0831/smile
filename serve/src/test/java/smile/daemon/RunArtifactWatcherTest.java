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
