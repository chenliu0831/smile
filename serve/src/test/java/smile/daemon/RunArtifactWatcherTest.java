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
