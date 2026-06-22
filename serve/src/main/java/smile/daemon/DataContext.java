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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import ioa.llm.tool.SharedSql;

/**
 * Builds a "what data is available right now" preamble that the daemon prepends to each user
 * turn (ADR: SQL-driven exploration). This is what lets the user just ask "summarize my
 * dataset" or "run AutoML" WITHOUT first running Load Dataset or telling the agent a path:
 * the agent is told, every turn, the DuckDB tables in its shared session (the same ones the
 * SQL console shows / the user saved) and any files under {@code input/}, plus explicit
 * guidance to query those tables via the SQL tool rather than hunting the filesystem.
 *
 * <p>Without this, the agent only globs for files and cannot see a table the user created
 * with "Save as table" (an in-memory DuckDB table, not a file), so AutoML/summarize fail with
 * "I couldn't find a file named …".
 *
 * @author Haifeng Li
 */
final class DataContext {
    private DataContext() {}

    private static final int MAX_TABLES = 30;
    private static final int MAX_COLS_LISTED = 40;

    /** Cache the describe() column-suffix per table so we don't re-DESCRIBE every turn. The
     * table SET is checked each turn (one cheap tables() call); only new tables are described. */
    private static final Map<String, String> COLUMN_CACHE = new java.util.concurrent.ConcurrentHashMap<>();

    /**
     * Returns a short, bounded data-context block to prepend to {@code userText}, or an empty
     * string if there is genuinely no data yet (so the agent can ask the user to load some).
     *
     * @param workingDir the agent's working directory (its {@code input/} is scanned).
     */
    static String preamble(Path workingDir) {
        List<String> tables = sharedTables();
        List<String> files = inputFiles(workingDir);
        if (tables.isEmpty() && files.isEmpty()) {
            return ""; // no data context to assert
        }

        StringBuilder sb = new StringBuilder();
        sb.append("[DATA CONTEXT — the user's current data is already available; do NOT ask for a file path or search the filesystem for it unless this context is empty.]\n");

        if (!tables.isEmpty()) {
            sb.append("DuckDB tables in your shared SQL session (query them with the SQL tool, e.g. `SQL execute \"SELECT * FROM <table> LIMIT 50\"`; the user sees these same tables in the app's Tables panel):\n");
            for (String t : tables) {
                sb.append("  - ").append(t).append(columnSuffix(t)).append('\n');
            }
            sb.append("To summarize/EDA/AutoML on a table, read it via SQL (or `COPY <table> TO 'input/<table>.csv' (HEADER)` first if a skill needs a file).\n");
        }
        if (!files.isEmpty()) {
            // Secondary: the DuckDB tables above are the primary data; input/ files are the
            // ADR-0005 path convention for skills that need a file on disk.
            sb.append("Also available as files in ./input/ (for skills that need a path): ")
              .append(String.join(", ", files)).append('\n');
        }
        // The UI renders a rich EDA canvas from files the agent leaves behind: a markdown
        // summary and any PNG charts. Nudge the agent to persist them so summarization isn't
        // trapped in chat text.
        sb.append("RENDERING: when you summarize or do EDA, ALSO write the written summary to `summary.md` ")
          .append("in the working directory (in addition to your chat reply) and save any charts as `.png` ")
          .append("files in the working directory — the app renders these as a rich data view.\n");
        sb.append("[END DATA CONTEXT]\n\n");
        return sb.toString();
    }

    /** The shared-session table names, or empty on any error (context is best-effort). */
    private static List<String> sharedTables() {
        try {
            List<String> all = SessionTables.list();
            return all.size() > MAX_TABLES ? all.subList(0, MAX_TABLES) : all;
        } catch (Throwable t) {
            return List.of();
        }
    }

    /** " (col:type, col:type, …)" for a table, cached so a table is DESCRIBEd at most once
     * (columns rarely change for a given table name; CREATE OR REPLACE evicts via the SET
     * check is not done, but a stale column list is far cheaper than re-describing 30 tables
     * every turn — and the table name itself is always current). "" if describe fails. */
    private static String columnSuffix(String table) {
        String cached = COLUMN_CACHE.get(table);
        if (cached != null) return cached;
        try {
            List<SharedSql.Column> cols = SessionTables.columns(table);
            if (cols.isEmpty()) return "";
            String list = cols.stream().limit(MAX_COLS_LISTED)
                    .map(c -> c.name() + ":" + c.type())
                    .collect(Collectors.joining(", "));
            String more = cols.size() > MAX_COLS_LISTED ? ", …" : "";
            String suffix = " (" + list + more + ")";
            COLUMN_CACHE.put(table, suffix);
            return suffix;
        } catch (Throwable t) {
            return "";
        }
    }

    /** Regular files directly under {@code <workingDir>/input/}, or empty. */
    private static List<String> inputFiles(Path workingDir) {
        Path input = workingDir.resolve("input");
        if (!Files.isDirectory(input)) return List.of();
        try (Stream<Path> s = Files.list(input)) {
            List<String> names = new ArrayList<>();
            s.filter(Files::isRegularFile)
                    .forEach(p -> names.add(p.getFileName().toString()));
            return names;
        } catch (IOException e) {
            return List.of();
        }
    }
}
