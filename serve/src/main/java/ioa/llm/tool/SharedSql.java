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
package ioa.llm.tool;

import java.io.ByteArrayOutputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

/**
 * Bridge to the ioa agent's process-global DuckDB session (SQL-driven exploration).
 *
 * <p>The ioa {@code SQL} tool keeps a single JVM-global {@code smile.data.SQL} instance
 * (a {@code private static volatile} field) created lazily and reachable only through its
 * <em>package-private</em> static {@code getSQL()} method. Reaching it gives the UI's
 * {@code /sql} endpoint and the agent's SQL tool ONE shared DuckDB session: a table either
 * side creates is immediately queryable by the other (single source of truth).
 *
 * <p><b>Why everything is reflective (no direct {@code smile.data.SQL} references):</b>
 * Quarkus loads application classes (the ioa jar + base, where the SQL singleton, its
 * {@code smile.data.DataFrame} results, and {@code smile.io.Arrow} all live) in a DIFFERENT
 * classloader than the deployment-augmented loader that holds {@code serve}'s own classes.
 * If {@code serve} code referenced {@code smile.data.SQL} directly, its copy of that class
 * would differ from the agent's, giving either {@link IllegalAccessError} (package-private
 * across loaders) or {@link ClassCastException} ("SQL cannot be cast to SQL"). Forcing the
 * smile stack parent-first "fixes" the cast but breaks DuckDB/Arrow static-init (their
 * transitive deps aren't parent-first) and model deserialization. So instead this shim does
 * ALL work reflectively against the singleton's own loader and hands {@code serve} back only
 * JDK types ({@code byte[]} Arrow IPC, {@code int}, {@code List<String>}). No parent-first,
 * no shared-class requirement.
 *
 * <p>The execution methods on the underlying {@code smile.data.SQL} are {@code synchronized},
 * so the daemon worker thread and the agent SDK thread never use the one JDBC connection
 * concurrently.
 */
public final class SharedSql {
    private SharedSql() {}

    /**
     * Per-statement timeout applied to the shared session so a runaway query aborts at the
     * DuckDB layer and releases the instance monitor. Slightly under the daemon's HTTP-side
     * future timeout so the statement is cancelled before (or about when) the caller gives up.
     */
    private static final int STATEMENT_TIMEOUT_SECONDS = 30;

    /** Cached reflective handles, resolved once against the singleton's own loader. */
    private static volatile Handles handles;

    /** Result of a SELECT: Arrow IPC bytes, row/column counts, and whether rows were cut. */
    public record QueryResult(byte[] arrowIpc, int rows, int cols, boolean truncated) {}

    private record Handles(
            Object sql,            // the smile.data.SQL singleton
            Method query,          // SQL.query(String) -> DataFrame
            Method update,         // SQL.update(String) -> int
            Method execute,        // SQL.execute(String) -> boolean
            Method tablesMethod,   // SQL.tables() -> DataFrame
            Method dfNrow,         // DataFrame.nrow() -> int
            Method dfNcol,         // DataFrame.ncol() -> int
            Method dfSlice,        // DataFrame.slice(int, int) -> DataFrame
            Method dfColumnByName, // DataFrame.column(String) -> ValueVector
            Method vecGet,         // ValueVector.get(int) -> Object
            Object arrow,          // a smile.io.Arrow instance
            Method arrowWrite) {}  // Arrow.write(DataFrame, OutputStream)

    private static Handles handles() throws ReflectiveOperationException {
        Handles h = handles;
        if (h == null) {
            synchronized (SharedSql.class) {
                h = handles;
                if (h == null) {
                    Class<?> sqlTool = Class.forName("ioa.llm.tool.SQL");
                    Method getSQL = sqlTool.getDeclaredMethod("getSQL");
                    getSQL.setAccessible(true);
                    Object sql = getSQL.invoke(null);
                    if (sql == null) throw new IllegalStateException("getSQL() returned null");

                    // Resolve all types from the SINGLETON's own classloader so every
                    // class matches the instance (DataFrame, ValueVector, Arrow).
                    ClassLoader cl = sql.getClass().getClassLoader();
                    Class<?> sqlClass = sql.getClass();
                    Class<?> dfClass = Class.forName("smile.data.DataFrame", false, cl);
                    Class<?> vecClass = Class.forName("smile.data.vector.ValueVector", false, cl);
                    Class<?> arrowClass = Class.forName("smile.io.Arrow", false, cl);

                    Object arrow = arrowClass.getDeclaredConstructor().newInstance();

                    // Bound runaway statements at the JDBC layer so a slow query aborts and
                    // releases the shared instance monitor (otherwise the agent and other
                    // /sql calls block for the query's full natural duration). Best-effort:
                    // older ioa jars without queryTimeout() simply skip this.
                    try {
                        Method qt = sqlClass.getMethod("queryTimeout", int.class);
                        qt.invoke(sql, STATEMENT_TIMEOUT_SECONDS);
                    } catch (NoSuchMethodException ignored) {
                        // base predates the timeout setter; the daemon's future timeout still
                        // returns a 503 to the caller (without aborting the statement).
                    }

                    h = new Handles(
                            sql,
                            sqlClass.getMethod("query", String.class),
                            sqlClass.getMethod("update", String.class),
                            sqlClass.getMethod("execute", String.class),
                            sqlClass.getMethod("tables"),
                            dfClass.getMethod("nrow"),
                            dfClass.getMethod("ncol"),
                            dfClass.getMethod("slice", int.class, int.class),
                            dfClass.getMethod("column", String.class),
                            vecClass.getMethod("get", int.class),
                            arrow,
                            arrowClass.getMethod("write", dfClass, java.io.OutputStream.class));
                    handles = h;
                }
            }
        }
        return h;
    }

    /** Unwraps a reflective invocation failure to its cause as a {@link ToolException}. */
    private static ToolException toToolException(Throwable t, String what) {
        Throwable cause = (t instanceof InvocationTargetException && t.getCause() != null)
                ? t.getCause() : t;
        if (cause instanceof ToolException te) return te;
        ToolException te = new ToolException(what + ": " + cause.getMessage());
        te.initCause(cause);
        return te;
    }

    /**
     * Runs a query and returns up to {@code maxRows} rows as Arrow IPC bytes. The caller's
     * SQL is fetched with one extra row ({@code maxRows + 1}) so true truncation can be
     * detected precisely: if more than {@code maxRows} rows come back, the surplus is sliced
     * off and {@link QueryResult#truncated()} is true. Serialization happens in the
     * singleton's loader so the {@code DataFrame} and {@code Arrow} classes match.
     *
     * @param sql a single result-returning statement (the caller wraps it as a subquery).
     * @param maxRows the maximum rows to return.
     * @throws QueryTypeException if the result has a column type the Arrow/DataFrame bridge
     *         cannot map — the caller retries with the offending columns CAST to VARCHAR.
     * @throws ToolException on any other failure (bad SQL, engine error).
     */
    public static QueryResult query(String sql, int maxRows) throws ToolException, QueryTypeException {
        try {
            Handles h = handles();
            Object df = h.query.invoke(h.sql, "SELECT * FROM (\n" + sql + "\n) AS _smile_lim LIMIT " + (maxRows + 1));
            int rows = (int) h.dfNrow.invoke(df);
            int cols = (int) h.dfNcol.invoke(df);
            boolean truncated = rows > maxRows;
            if (truncated) {
                df = h.dfSlice.invoke(df, 0, maxRows);
                rows = maxRows;
            }
            var bos = new ByteArrayOutputStream();
            h.arrowWrite.invoke(h.arrow, df, bos);
            return new QueryResult(bos.toByteArray(), rows, cols, truncated);
        } catch (InvocationTargetException e) {
            // UnsupportedOperationException from the DataFrame/Arrow bridge => composite type.
            if (e.getCause() instanceof UnsupportedOperationException u) {
                throw new QueryTypeException(u.getMessage());
            }
            throw toToolException(e, "SQL query failed");
        } catch (ReflectiveOperationException e) {
            throw toToolException(e, "SQL bridge unavailable");
        }
    }

    /** Runs an INSERT/UPDATE/DELETE; returns the affected row count. */
    public static int update(String sql) throws ToolException {
        try {
            Handles h = handles();
            return (int) h.update.invoke(h.sql, sql);
        } catch (ReflectiveOperationException e) {
            throw toToolException(e, "SQL update failed");
        }
    }

    /** Runs any other statement (CREATE/DROP/ALTER/COPY/PRAGMA …). */
    public static void execute(String sql) throws ToolException {
        try {
            Handles h = handles();
            h.execute.invoke(h.sql, sql);
        } catch (ReflectiveOperationException e) {
            throw toToolException(e, "SQL execute failed");
        }
    }

    /** Lists the user (non-internal) tables currently in the shared session. */
    public static List<String> tables() throws ToolException {
        try {
            Handles h = handles();
            Object df = h.tablesMethod.invoke(h.sql);
            int n = (int) h.dfNrow.invoke(df);
            Object col = h.dfColumnByName.invoke(df, "table_name");
            List<String> names = new ArrayList<>(n);
            for (int i = 0; i < n; i++) {
                names.add(String.valueOf(h.vecGet.invoke(col, i)));
            }
            return names;
        } catch (ReflectiveOperationException e) {
            throw toToolException(e, "SQL tables() failed");
        }
    }

    /**
     * Whether the shared SQL session is reachable. Used at startup / by a smoke test so an
     * ioa-jar change that hides {@code getSQL()} fails loudly instead of silently disabling
     * the SQL console.
     */
    public static boolean isAvailable() {
        try {
            handles();
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    /** Raised when a SELECT result carries a column type the Arrow bridge can't map. */
    public static final class QueryTypeException extends Exception {
        public QueryTypeException(String message) { super(message); }
    }
}
