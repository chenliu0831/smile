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
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.stream.Stream;
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
    /** Stage ids already announced as 'running' (so we emit each running transition once). */
    private final Set<String> runningStage = ConcurrentHashMap.newKeySet();
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
        boolean anyDoneThisScan = false;
        for (StageSpec spec : STAGES) {
            if (announcedStages.contains(spec.stageId())) continue;
            Path file = workingDir.resolve(spec.relPath());
            if (!Files.isRegularFile(file)) continue;

            announcedStages.add(spec.stageId());
            anyDoneThisScan = true;
            List<String> refs = spec.artifactKind() != null ? List.of(spec.stageId()) : List.of();
            emit.accept(new StageProgress(sessionId,
                new Stage(spec.stageId(), spec.label(), StageStatus.done, refs, spec.relPath())));

            if (spec.artifactKind() != null && announcedArtifacts.add(spec.stageId())) {
                emit.accept(new ArtifactMsg(sessionId, buildArtifact(spec, file)));
            }
        }
        // Give the Timeline a live current-stage: once any stage has completed (so a real
        // automl run is underway), mark the FIRST not-yet-done stage as running. Without
        // this, stages jump pending->done and the pipeline never shows an in-progress step
        // for the canvas to focus (audit #10). Re-announced only when it advances.
        if (anyDoneThisScan && !announcedStages.isEmpty()) {
            for (StageSpec spec : STAGES) {
                if (!announcedStages.contains(spec.stageId())) {
                    if (runningStage.add(spec.stageId())) {
                        emit.accept(new StageProgress(sessionId,
                            new Stage(spec.stageId(), spec.label(), StageStatus.running, List.of(), null)));
                    }
                    break;
                }
            }
        }
        scanFreeformArtifacts();
    }

    /**
     * Surface artifacts produced OUTSIDE the automl pipeline contract — chiefly the
     * {@code summarize}/EDA skill, which writes its charts as bare {@code *.png} into the
     * working-dir ROOT (not {@code output/}) and its text summary to stdout / a markdown
     * file. The automl-only STAGES table never watched these, so a "summarize my data" turn
     * produced nothing on the canvas. We scan the cwd root for new {@code .png} (inlined as
     * base64 image artifacts) and a {@code summary.md}/{@code eda_report.md} report so the
     * canvas can render a rich EDA view without a full AutoML run.
     */
    private void scanFreeformArtifacts() {
        // Markdown summary written directly into the cwd (the automl eda_report.md under
        // output/ is handled by STAGES; this covers the summarize skill's own file).
        for (String md : List.of("summary.md", "eda_report.md", "data_summary.md")) {
            Path f = workingDir.resolve(md);
            if (!Files.isRegularFile(f)) continue;
            // mtime-stamped key so a regenerated summary re-emits; stable artifact ref so the
            // canvas replaces the prior version in place.
            String key = "freeform:" + md + ":" + mtimeOf(f);
            if (announcedArtifacts.add(key)) {
                emit.accept(new ArtifactMsg(sessionId,
                    new Artifact("freeform:" + md, "report", "Data Summary",
                        readBounded(f), null, null, f.toString())));
            }
        }
        // PNG charts written to the cwd root by the summarize/EDA skills. Scoped to the
        // skill's known chart names/prefixes so we don't inline unrelated images the agent
        // may have opened/produced for other reasons.
        try (Stream<Path> s = Files.list(workingDir)) {
            s.filter(Files::isRegularFile)
                .filter(p -> isSummaryChart(p.getFileName().toString()))
                .sorted()
                .forEach(p -> {
                    // Stamp the dedupe key with the file's mtime so a SECOND summarize turn
                    // that overwrites the same chart filename re-emits the new content
                    // instead of being suppressed as already-announced.
                    long mtime = mtimeOf(p);
                    String ref = "img:" + p.getFileName() + ":" + mtime;
                    if (announcedArtifacts.add(ref)) {
                        String dataUri = readImageDataUri(p);
                        if (dataUri != null) {
                            // Stable artifact ref (no mtime) so the canvas replaces the prior
                            // version in place rather than stacking a new tab each re-run.
                            emit.accept(new ArtifactMsg(sessionId,
                                new Artifact("img:" + p.getFileName(), "image",
                                    chartTitle(p.getFileName().toString()),
                                    dataUri, null, null, p.toString())));
                        }
                    }
                });
        } catch (IOException ignored) {
            // cwd not listable this tick; try again next poll.
        }
    }

    private static long mtimeOf(Path p) {
        try {
            return Files.getLastModifiedTime(p).toMillis();
        } catch (IOException e) {
            return 0L;
        }
    }

    /** Whether a cwd PNG is one of the summarize/EDA skill's chart outputs (vs an unrelated
     * image). Matches the skill's fixed names and its per-column cat_ / hist_ prefixes. */
    private static boolean isSummaryChart(String fileName) {
        String n = fileName.toLowerCase();
        if (!n.endsWith(".png")) return false;
        return n.startsWith("correlation") || n.startsWith("distribution")
            || n.startsWith("categorical") || n.startsWith("time_series")
            || n.startsWith("numeric") || n.startsWith("cat_") || n.startsWith("hist_")
            || n.startsWith("box_") || n.startsWith("chart") || n.contains("heatmap");
    }

    /** A human title from a chart filename, e.g. "correlation_heatmap.png" -> "Correlation Heatmap". */
    private static String chartTitle(String fileName) {
        String stem = fileName.replaceFirst("\\.[^.]+$", "").replace('_', ' ').strip();
        if (stem.isEmpty()) return fileName;
        return Character.toUpperCase(stem.charAt(0)) + stem.substring(1);
    }

    /** Read a PNG as a {@code data:image/png;base64,…} URI, bounded so a huge image can't
     * flood the socket. Returns null on error or if the file exceeds the cap. */
    private static String readImageDataUri(Path file) {
        try {
            long size = Files.size(file);
            if (size > 4_000_000) return null; // 4 MB cap; charts are far smaller
            byte[] bytes = Files.readAllBytes(file);
            return "data:image/png;base64," + Base64.getEncoder().encodeToString(bytes);
        } catch (IOException e) {
            return null;
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
