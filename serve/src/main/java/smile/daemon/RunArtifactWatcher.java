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

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import smile.daemon.DaemonMessage.*;

/**
 * Watches the agent's working directory for the {@code automl} skill's known output
 * files and translates their appearance into structured {@link StageProgress} and
 * {@link ArtifactMsg} messages (ADR-0006). This lifts an AutoML run from a flat stream
 * of tool-call cards into a progressive-disclosure pipeline — a live timeline plus a
 * canvas of reports/leaderboards — WITHOUT reading the skill's private {@code state.json}
 * (the file appearances are the stable, public contract per ADR-0005/0006).
 *
 * <p>Poll-based (a {@code WatchService} misses files created in subdirectories created
 * after registration). Cheap: a handful of {@code Files.exists} checks per tick.
 *
 * @author Haifeng Li
 */
public final class RunArtifactWatcher {
    /** A pipeline stage keyed to the artifact file whose existence marks it done. */
    private record StageSpec(String stageId, String label, String relPath, String artifactKind, String artifactTitle) {}

    /** The automl skill's stages in order, each completed by a known output file. */
    private static final List<StageSpec> STAGES = List.of(
        new StageSpec("eda", "Exploratory Data Analysis", "output/eda_report.md", "report", "EDA Report"),
        new StageSpec("preprocess", "Preprocessing", "output/train_clean.csv", null, null),
        new StageSpec("features", "Feature Engineering", "output/train_features.csv", null, null),
        new StageSpec("candidates", "Candidate Evaluation", "output/candidate_scores.md", "leaderboard", "Leaderboard"),
        new StageSpec("refine", "Iterative Refinement", "output/refinement_log.md", "report", "Refinement Log"),
        new StageSpec("solution", "Final Solution", "output/solution_final.py", "file", "solution_final.py"),
        new StageSpec("evaluate", "Final Evaluation", "output/model_evaluation_report.md", "report", "Evaluation Report"),
        new StageSpec("report", "Report", "output/automl_report.md", "report", "AutoML Report"),
        new StageSpec("submission", "Submission", "final/submission.csv", "file", "submission.csv")
    );

    private final String sessionId;
    private final Path workingDir;
    private final Consumer<DaemonMessage> emit;
    private final Set<String> announcedStages = ConcurrentHashMap.newKeySet();
    private final Set<String> announcedArtifacts = ConcurrentHashMap.newKeySet();
    private volatile boolean started = false;
    private volatile boolean stopped = false;
    private Thread thread;

    public RunArtifactWatcher(String sessionId, Path workingDir, Consumer<DaemonMessage> emit) {
        this.sessionId = sessionId;
        this.workingDir = workingDir;
        this.emit = emit;
    }

    /** Begin polling on a daemon thread until {@link #stop()}. Idempotent. */
    public synchronized void start() {
        if (started) return;
        started = true;
        thread = new Thread(this::loop, "run-artifact-watcher");
        thread.setDaemon(true);
        thread.start();
    }

    public void stop() {
        stopped = true;
    }

    private void loop() {
        // Seed the timeline as pending so the UI shows the whole pipeline up front.
        emit.accept(new RunStarted(sessionId, "AutoML",
            STAGES.stream()
                .map(s -> new Stage(s.stageId(), s.label(), StageStatus.pending, List.of(), null))
                .toList()));

        while (!stopped) {
            scanOnce();
            try {
                Thread.sleep(750);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
        // Final scan so artifacts written just before stop aren't missed.
        scanOnce();
    }

    /** Emit progress/artifacts for any stage files that have newly appeared. */
    private void scanOnce() {
        for (StageSpec spec : STAGES) {
            if (announcedStages.contains(spec.stageId())) continue;
            Path file = workingDir.resolve(spec.relPath());
            if (!Files.isRegularFile(file)) continue;

            announcedStages.add(spec.stageId());
            List<String> refs = spec.artifactKind() != null ? List.of(spec.stageId()) : List.of();
            emit.accept(new StageProgress(sessionId,
                new Stage(spec.stageId(), spec.label(), StageStatus.done, refs, spec.relPath())));

            if (spec.artifactKind() != null && announcedArtifacts.add(spec.stageId())) {
                emit.accept(new ArtifactMsg(sessionId, buildArtifact(spec, file)));
            }
        }
    }

    private Artifact buildArtifact(StageSpec spec, Path file) {
        String body = null;
        // Inline small text artifacts (reports/leaderboards) so the canvas renders them.
        if (!"file".equals(spec.artifactKind())) {
            body = readBounded(file);
        }
        return new Artifact(spec.stageId(), spec.artifactKind(), spec.artifactTitle(),
            body, null, null, file.toString());
    }

    /** Read a text file, bounded to keep big artifacts from flooding the socket. */
    private static String readBounded(Path file) {
        try {
            byte[] bytes = Files.readAllBytes(file);
            int max = 200_000;
            if (bytes.length <= max) return new String(bytes);
            return new String(bytes, 0, max) + "\n\n… (truncated)";
        } catch (IOException e) {
            return null;
        }
    }

    /** The stage specs (id -> label), exposed for tests / introspection. */
    static Map<String, String> stageLabels() {
        Map<String, String> m = new LinkedHashMap<>();
        for (StageSpec s : STAGES) m.put(s.stageId(), s.label());
        return m;
    }
}
