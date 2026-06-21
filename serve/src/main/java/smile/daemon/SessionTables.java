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
import ioa.llm.tool.SharedSql;
import ioa.llm.tool.SharedSql.Column;
import ioa.llm.tool.ToolException;

/**
 * The daemon-side gateway to the shared DuckDB session's TABLE METADATA (SQL-driven
 * exploration). Before this, four daemon files reached the process-global {@link SharedSql}
 * bridge directly, each re-implementing the same two idioms: the case-insensitive
 * "does this table exist?" check and the safe-identifier guard. This concentrates that
 * knowledge in one place so it's defined once and the resources depend on a small, fakeable
 * interface rather than a static global.
 *
 * <p>Scope: metadata access only — table existence, listing, and column schema. Raw
 * statement execution (query/update/execute) stays in {@link SqlResource}, which owns the
 * HTTP timeout, Arrow streaming, and DDL/DML routing; wrapping those here would add a
 * pass-through with no leverage. This gateway is the seam for "what tables/columns exist",
 * which is what was actually scattered.
 *
 * @author Haifeng Li
 */
public final class SessionTables {
    private SessionTables() {}

    /** A plain SQL identifier: letters/digits/underscores, not starting with a digit. */
    private static final java.util.regex.Pattern IDENTIFIER =
            java.util.regex.Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");

    /**
     * Whether {@code name} is a plain, injection-safe SQL identifier. The single definition
     * of the grammar that was hand-written in SqlResource, DataResource, SqlLineage,
     * ToolPresenter, and SharedSql. Pure — unit-tested without a session.
     */
    public static boolean isValidIdentifier(String name) {
        return name != null && IDENTIFIER.matcher(name).matches();
    }

    /**
     * Whether a table of this name exists in the shared session (case-insensitive). This is
     * the existence check that was duplicated verbatim in {@code SqlResource.save} and
     * {@code DataResource.isSessionTable}. A non-identifier name is never a session table
     * (and never hits the engine).
     */
    public static boolean exists(String name) throws ToolException {
        if (!isValidIdentifier(name)) return false;
        return SharedSql.tables().stream().anyMatch(t -> t.equalsIgnoreCase(name));
    }

    /**
     * Like {@link #exists} but swallows a bridge failure as {@code false} (no session yet /
     * bridge unavailable) — for callers on a hot path that must degrade rather than error
     * (e.g. {@code DataResource} falling through to demo data).
     */
    public static boolean existsQuietly(String name) {
        try {
            return exists(name);
        } catch (Throwable t) {
            return false;
        }
    }

    /** The user (non-internal) tables currently in the shared session. */
    public static List<String> list() throws ToolException {
        return SharedSql.tables();
    }

    /** The columns of one table/view (validated name, via DuckDB DESCRIBE). */
    public static List<Column> columns(String table) throws ToolException {
        return SharedSql.describe(table);
    }

    /** Every user table's columns in ONE query (avoids N+1 DESCRIBE). table -> columns. */
    public static Map<String, List<Column>> allColumns() throws ToolException {
        return SharedSql.allColumns();
    }

    /** A bounded, column-oriented projection of a table for charting. */
    public static Map<String, List<Object>> columnTable(String table, List<Column> cols, int rows)
            throws ToolException {
        return SharedSql.columnTable(table, cols, rows);
    }
}
