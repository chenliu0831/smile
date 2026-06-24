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
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import ioa.llm.tool.SharedSql;
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
    /**
     * A pipeline stage marked done by the FIRST of its candidate files to appear. The agent
     * doesn't always honor the skill's canonical filename (it may do EDA inline, name the
     * leaderboard {@code leaderboard.csv} instead of {@code candidate_scores.md}, skip
     * {@code train_clean.csv}, etc.), so each stage lists its canonical name plus the common
     * variants this codebase has observed real runs produce. The canonical name is first; it
     * is the one the {@code artifactKind} body/preview is built from when present.
     */
    private record StageSpec(String stageId, String label, List<String> relPaths, String artifactKind, String artifactTitle) {
        /** The canonical (preferred) relative path. */
        String canonical() { return relPaths.get(0); }
    }

    /** The automl skill's stages in order, each completed by the first of its files to appear. */
    private static final List<StageSpec> STAGES = List.of(
        new StageSpec("eda", "Exploratory Data Analysis",
            List.of("output/eda_report.md", "output/eda_summary.json", "summary.md", "output/eda.py"), "report", "EDA Report"),
        new StageSpec("preprocess", "Preprocessing",
            List.of("output/train_clean.csv", "output/preprocess_features.py"), null, null),
        new StageSpec("features", "Feature Engineering",
            List.of("output/train_features.csv"), null, null),
        new StageSpec("candidates", "Candidate Evaluation",
            List.of("output/candidate_scores.md", "output/leaderboard.csv", "output/run_candidates.py"), "leaderboard", "Leaderboard"),
        new StageSpec("refine", "Iterative Refinement",
            List.of("output/refinement_log.md", "output/leaderboard_final.csv"), "report", "Refinement Log"),
        new StageSpec("solution", "Final Solution",
            List.of("output/solution_final.py"), "file", "solution_final.py"),
        new StageSpec("evaluate", "Final Evaluation",
            List.of("output/model_evaluation_report.md", "output/postprocess_results.json"), "report", "Evaluation Report"),
        new StageSpec("report", "Report",
            List.of("output/automl_report.md", "output/summary.md"), "report", "AutoML Report"),
        // Predictions: prefer an OOF file (carries the ground-truth label column, so Predictions
        // Studio can compute ROC/confusion) over the bare submission (test preds, no truth).
        new StageSpec("submission", "Submission",
            List.of("output/oof_final.csv", "final/submission.csv", "output/submission.csv", "output/oof_preds.csv"),
            "file", "Predictions")
    );

    /** A file smaller than this is treated as a stub/placeholder and skipped in favor of a
     * later alias with real content (e.g. a 25-byte `# Candidate Leaderboard\n\n` stub while
     * the real table is in `leaderboard.csv`). Falls back to the stub only if nothing else. */
    private static final long STUB_BYTES = 64;

    /**
     * Resolve a stage's preferred existing file under the working dir, or null if none exist
     * yet. Prefers the FIRST alias whose content is non-trivial (≥ {@value #STUB_BYTES} bytes);
     * if every present alias is a stub, returns the first present one so the stage still
     * completes. This stops a placeholder file (canonical name, empty body) from shadowing a
     * richer variant the agent actually filled in.
     */
    private Path firstExisting(StageSpec spec) {
        Path firstAny = null;
        for (String rel : spec.relPaths()) {
            Path p = workingDir.resolve(rel);
            if (!Files.isRegularFile(p)) continue;
            if (firstAny == null) firstAny = p;
            if (sizeOf(p) >= STUB_BYTES) return p; // first non-stub wins
        }
        return firstAny; // all present aliases are stubs (or none) → first present, else null
    }

    private static long sizeOf(Path p) {
        try { return Files.size(p); } catch (IOException e) { return 0L; }
    }

    /** A public JSON sidecar surfaced as a structured artifact (ADR-0011/0014): its parsed
     * JSON rides the artifact's {@code meta} and the consumer parses it. */
    private record JsonSidecar(String relPath, String ref, String kind, String title) {}

    /** Skill-emitted public JSON sidecars the cockpit consumes (ADR-0014). The diagnostics
     * and metrics refs drive dedicated surfaces; the params companion (kind "metrics", ref
     * "params") joins into the Leaderboard rather than its own canvas tab. */
    private static final List<JsonSidecar> JSON_SIDECARS = List.of(
        new JsonSidecar("output/postprocess_results.json", "diagnostics", "diagnostics", "Driver Diagnostics"),
        new JsonSidecar("output/final_metrics.json", "metrics", "metrics", "Run Scorecard"),
        new JsonSidecar("output/best_params.json", "params", "metrics", "Tuned Hyperparameters")
    );

    private static final ObjectMapper JSON = new ObjectMapper();

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
        // Index of the latest stage marked done this lifetime, so we can BACKFILL earlier
        // stages the agent skipped (e.g. it did EDA inline and never wrote eda_report.md, but
        // later stages completed — EDA must not strand the whole timeline at 'running').
        int latestDoneIdx = -1;
        for (int i = 0; i < STAGES.size(); i++) {
            StageSpec spec = STAGES.get(i);
            if (announcedStages.contains(spec.stageId())) { latestDoneIdx = Math.max(latestDoneIdx, i); continue; }
            Path file = firstExisting(spec);
            if (file == null) continue;

            announcedStages.add(spec.stageId());
            anyDoneThisScan = true;
            latestDoneIdx = Math.max(latestDoneIdx, i);
            emitStageDone(spec, file);
        }

        // BACKFILL: any stage BEFORE the latest completed one that is still pending was
        // skipped or done inline by the agent. Mark it done (no artifact — none was written)
        // so the timeline advances instead of stranding on a missing early file.
        if (latestDoneIdx >= 0) {
            for (int i = 0; i < latestDoneIdx; i++) {
                StageSpec spec = STAGES.get(i);
                if (announcedStages.add(spec.stageId())) {
                    anyDoneThisScan = true;
                    // Try its files anyway (a variant may exist); else mark done with no ref.
                    Path file = firstExisting(spec);
                    if (file != null) emitStageDone(spec, file);
                    else emit.accept(new StageProgress(sessionId,
                        new Stage(spec.stageId(), spec.label(), StageStatus.done, List.of(), null)));
                }
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
        scanJsonSidecars();
        rescanReportMtime();
    }

    /** Emit a stage's done transition + its artifact (if it carries one), deduped. */
    private void emitStageDone(StageSpec spec, Path file) {
        List<String> refs = spec.artifactKind() != null ? List.of(spec.stageId()) : List.of();
        emit.accept(new StageProgress(sessionId,
            new Stage(spec.stageId(), spec.label(), StageStatus.done, refs, workingDir.relativize(file).toString())));
        if (spec.artifactKind() != null && announcedArtifacts.add(spec.stageId())) {
            emit.accept(new ArtifactMsg(sessionId, buildArtifact(spec, file)));
            if ("report".equals(spec.stageId())) {
                announcedArtifacts.add("report-mtime:" + mtimeOf(file));
            }
        }
    }

    /**
     * Re-emit the AutoML report when it is regenerated (S8). The STAGES loop emits each stage
     * artifact exactly once (keyed by stable stageId), so a re-run that overwrites
     * {@code output/automl_report.md} would not refresh the canvas. This re-emits the report
     * artifact whenever its mtime advances — same mtime-keyed re-emit the image path uses —
     * with the SAME stable ref ("report") so the canvas replaces it in place rather than
     * stacking a new tab. Only fires after the stage has been announced once.
     */
    private void rescanReportMtime() {
        if (!announcedStages.contains("report")) return;
        Path f = workingDir.resolve("output/automl_report.md");
        if (!Files.isRegularFile(f)) return;
        String key = "report-mtime:" + mtimeOf(f);
        if (!announcedArtifacts.add(key)) return; // unchanged since last emit
        emit.accept(new ArtifactMsg(sessionId,
            new Artifact("report", "report", "AutoML Report", readBounded(f), null, null, f.toString(), null)));
    }

    /**
     * Surface skill-emitted public JSON sidecars (ADR-0014) as structured artifacts: the
     * file's parsed JSON rides the artifact's {@code meta}, and the consumer parses it (the
     * daemon does not interpret the schema). mtime-keyed dedupe so a regenerated sidecar
     * re-emits; stable artifact ref so the canvas replaces in place. A parse failure is
     * skipped (retried next tick) rather than emitting a broken artifact.
     */
    private void scanJsonSidecars() {
        for (JsonSidecar s : JSON_SIDECARS) {
            Path f = workingDir.resolve(s.relPath());
            if (!Files.isRegularFile(f)) continue;
            String key = "json:" + s.ref() + ":" + mtimeOf(f);
            if (!announcedArtifacts.add(key)) continue;
            JsonNode meta;
            try {
                meta = JSON.readTree(f.toFile());
            } catch (IOException e) {
                announcedArtifacts.remove(key); // unparseable this tick — retry next poll
                continue;
            }
            emit.accept(new ArtifactMsg(sessionId,
                new Artifact(s.ref(), s.kind(), s.title(), null, null, null, f.toString(), meta)));
        }
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
                        readBounded(f), null, null, f.toString(), null)));
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
                                    dataUri, null, null, p.toString(), null)));
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
            || n.startsWith("box_") || n.startsWith("chart") || n.contains("heatmap")
            // automl postprocess/eval charts (matplotlib PNGs the agent saves to the cwd root).
            // Native cockpit surfaces supersede the ones with structured data (ROC, confusion,
            // feature importance, leaderboard); the rest (e.g. calibration) surface as images.
            || n.contains("roc") || n.contains("confusion") || n.contains("calibration")
            || n.contains("importance") || n.contains("leaderboard") || n.contains("reliability")
            || n.contains("residual") || n.contains("shap") || n.contains("pr_curve")
            || n.contains("precision_recall") || n.contains("learning_curve");
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
        // The prediction set (final/submission.csv) is materialized ONCE into the shared
        // DuckDB session and surfaced as a `dataframe` artifact so Predictions Studio can
        // fetch its rows over /data/{ref} and compute ROC/confusion client-side (ADR-0011).
        if ("submission".equals(spec.stageId())) {
            Artifact df = buildPredictionsDataframe(file);
            if (df != null) return df;
            // Bridge unavailable / materialization failed → fall through to the path-only file.
        }
        String body = null;
        // Inline small text artifacts (reports/leaderboards) so the canvas renders them.
        if (!"file".equals(spec.artifactKind())) {
            body = readBounded(file);
        }
        return new Artifact(spec.stageId(), spec.artifactKind(), spec.artifactTitle(),
            body, null, null, file.toString(), null);
    }

    /** The session table name the prediction set is materialized into. */
    private static final String SUBMISSION_TABLE = "submission";

    /**
     * Materialize {@code final/submission.csv} as a DuckDB TABLE in the shared session and
     * return a {@code dataframe} artifact referencing it. A TABLE (not a VIEW) so it is
     * listed by {@code duckdb_tables()} — which {@code DataResource}/{@code SessionTables}
     * resolve {@code /data/{ref}} against — and so the CSV is read exactly once (materialize-
     * once, per ADR-0011) rather than re-scanned on every fetch.
     *
     * <p>Returns null (caller falls back to a path-only {@code file} artifact) if the shared
     * SQL bridge is unavailable or the CREATE fails — the canvas still surfaces the file.
     */
    private Artifact buildPredictionsDataframe(Path file) {
        try {
            // read_csv_auto over the absolute path; single-quotes in the path are escaped.
            String path = file.toAbsolutePath().toString().replace("'", "''");
            SharedSql.execute("CREATE OR REPLACE TABLE \"" + SUBMISSION_TABLE
                + "\" AS SELECT * FROM read_csv_auto('" + path + "')");
            var data = new ArrowRef("arrow", SUBMISSION_TABLE, null, null);
            return new Artifact("submission", "dataframe", "Predictions",
                null, null, data, file.toString(), null);
        } catch (Throwable t) {
            return null;
        }
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
