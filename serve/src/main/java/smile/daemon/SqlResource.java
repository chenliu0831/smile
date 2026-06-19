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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Pattern;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import ioa.llm.tool.SharedSql;
import ioa.llm.tool.SharedSql.QueryResult;
import ioa.llm.tool.SharedSql.QueryTypeException;
import ioa.llm.tool.ToolException;

/**
 * The SQL console endpoint (SQL-driven exploration, Phase 1). Runs a single user SQL
 * statement against the SAME in-process DuckDB session the ioa agent uses — reached via
 * {@link SharedSql} (a fully-reflective bridge to the agent's {@code smile.data.SQL}
 * singleton) — so a table the user creates is queryable by the agent and vice versa.
 *
 * <p>Endpoint: {@code POST /api/v1/sql} with body {@code {"sql": "...", "maxRows": N?}}.
 * <ul>
 *   <li>SELECT / WITH → result streamed as an <b>Apache Arrow IPC stream</b>
 *       ({@code application/vnd.apache.arrow.stream}); wrapped in a server-side {@code LIMIT}
 *       so a huge result never streams in full.</li>
 *   <li>INSERT / UPDATE / DELETE → row count + table list as JSON.</li>
 *   <li>CREATE / DROP / ALTER / COPY / PRAGMA … → table list as JSON.</li>
 * </ul>
 *
 * <p>{@link SharedSql} calls base {@code smile.data.SQL} (not the ioa SQL tool's
 * {@code call()}), inheriting base's hardened single-statement / safe-identifier guards and
 * avoiding the tool's Swing viewer (headless-fatal) and Dataset cache.
 *
 * <p><b>Composite types:</b> DuckDB output like {@code SUM(...)} (HUGEINT) or list/struct
 * columns yields JDBC types the {@code DataFrame} bridge can't map. {@link SharedSql#query}
 * signals that with {@link QueryTypeException}; we retry once casting every column to
 * {@code VARCHAR} so arbitrary user SQL never hard-fails the fetch.
 *
 * @author Haifeng Li
 */
@Path("/sql")
public class SqlResource {
    private static final org.jboss.logging.Logger LOG = org.jboss.logging.Logger.getLogger(SqlResource.class);

    private static final int DEFAULT_MAX_ROWS = 10_000;
    private static final int MAX_ROWS_CAP = 100_000;
    // HTTP-side backstop, set ABOVE SharedSql's 30s JDBC query timeout so the DuckDB driver
    // aborts the statement (releasing the shared instance monitor) BEFORE this fires. This
    // future timeout only matters if the JDBC timeout somehow doesn't (e.g. an older base
    // jar without queryTimeout()); it returns a 503 but cannot itself free the connection.
    private static final long TIMEOUT_MS = 35_000;

    // Statements that return a result set. Besides SELECT/WITH, DuckDB supports FROM-first
    // (`FROM t`), TABLE, VALUES, PIVOT/UNPIVOT, DESCRIBE/SHOW/SUMMARIZE — all yield rows and
    // must be routed to runQuery, not execute() (which would discard the result set).
    private static final Pattern QUERY = Pattern.compile(
            "^\\s*(select|with|from|table|values|pivot|unpivot|describe|show|summarize)\\b",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern DML = Pattern.compile("^\\s*(insert|update|delete)\\b",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    /** Daemon threads so a leaked runaway query never blocks JVM shutdown. */
    private static final ExecutorService POOL = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "sql-exec");
        t.setDaemon(true);
        return t;
    });

    /** Request body: a single SQL statement and an optional result-row cap. */
    public record SqlRequest(String sql, Integer maxRows) {}

    /** JSON response for non-SELECT statements. */
    public record ExecResult(String kind, boolean ok, Integer rowsAffected, List<String> tables) {}

    /** JSON error response. */
    public record SqlError(String error) {}

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    public Response run(SqlRequest req) {
        final String sql = req == null || req.sql() == null ? "" : req.sql().trim();
        if (sql.isEmpty()) {
            return error(Response.Status.BAD_REQUEST, "No SQL statement provided.");
        }
        final int maxRows = clampMaxRows(req.maxRows());

        Future<Response> future = POOL.submit(() -> execute(sql, maxRows));
        try {
            return future.get(TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            future.cancel(true);
            LOG.warnf("SQL statement exceeded %dms timeout", TIMEOUT_MS);
            return error(Response.Status.SERVICE_UNAVAILABLE,
                    "Query exceeded the " + (TIMEOUT_MS / 1000) + "s timeout and was abandoned.");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return error(Response.Status.SERVICE_UNAVAILABLE, "Interrupted.");
        } catch (java.util.concurrent.ExecutionException e) {
            Throwable cause = e.getCause() == null ? e : e.getCause();
            String msg = rootMessage(cause);
            // A statement aborted by the JDBC query timeout (SharedSql sets setQueryTimeout)
            // surfaces as a SQLException whose message mentions INTERRUPT/timeout → 503, not
            // a user syntax error.
            if (isTimeout(msg)) {
                return error(Response.Status.SERVICE_UNAVAILABLE,
                        "Query was cancelled after exceeding the time limit.");
            }
            // Otherwise a ToolException wraps the engine error: bad SQL / guard violation →
            // the user's fault (400). The SQL engine raises java.sql.SQLException and
            // IllegalArgumentException (single-statement / safe-identifier guards) for those.
            if (isUserError(cause)) {
                return error(Response.Status.BAD_REQUEST, msg);
            }
            LOG.error("SQL execution failed", cause);
            return error(Response.Status.INTERNAL_SERVER_ERROR, msg);
        }
    }

    /** Runs the statement on the shared engine; called on the pool thread under the timeout. */
    private Response execute(String sql, int maxRows) throws ToolException {
        if (QUERY.matcher(sql).find()) {
            return runQuery(sql, maxRows);
        }
        if (DML.matcher(sql).find()) {
            int n = SharedSql.update(sql);
            return Response.ok(new ExecResult("dml", true, n, SharedSql.tables()))
                    .type(MediaType.APPLICATION_JSON).build();
        }
        SharedSql.execute(sql);
        return Response.ok(new ExecResult("ddl", true, null, SharedSql.tables()))
                .type(MediaType.APPLICATION_JSON).build();
    }

    /** Runs a result-returning statement, bounded to maxRows, with the composite CAST fallback. */
    private Response runQuery(String sql, int maxRows) throws ToolException {
        String inner = stripTrailingSemicolon(sql);
        long start = System.nanoTime();

        QueryResult qr;
        try {
            qr = SharedSql.query(wrap(inner, "*"), maxRows);
        } catch (QueryTypeException composite) {
            // A column type the result bridge can't map (LIST/STRUCT/HUGEINT/…). Re-run with
            // every column cast to VARCHAR so the fetch succeeds. COLUMNS(*) applies the cast
            // across all output columns while preserving their names.
            LOG.debugf("Composite-type result, retrying with VARCHAR cast: %s", composite.getMessage());
            try {
                qr = SharedSql.query(wrap(inner, "COLUMNS(*)::VARCHAR"), maxRows);
            } catch (QueryTypeException stillBad) {
                throw new ToolException("Result has an unsupported column type: " + stillBad.getMessage());
            }
        }
        long elapsedMs = (System.nanoTime() - start) / 1_000_000;

        final byte[] body = qr.arrowIpc();
        return Response.ok(body)
                .type("application/vnd.apache.arrow.stream")
                .header("X-Smile-Rows", qr.rows())
                .header("X-Smile-Cols", qr.cols())
                .header("X-Smile-Elapsed-Ms", elapsedMs)
                .header("X-Smile-Truncated", qr.truncated())
                .build();
    }

    /**
     * Wraps a user query as a subquery with the given projection. A leading newline before
     * the closing paren ensures a trailing single-line ({@code --}) comment in the user SQL
     * can't swallow the wrapper. The row LIMIT is applied by {@link SharedSql#query}.
     */
    private static String wrap(String inner, String projection) {
        return "SELECT " + projection + " FROM (\n" + inner + "\n) AS _smile_q";
    }

    private static boolean isTimeout(String message) {
        if (message == null) return false;
        String m = message.toLowerCase(java.util.Locale.ROOT);
        return m.contains("interrupt") || m.contains("timeout") || m.contains("cancel");
    }

    private static boolean isUserError(Throwable cause) {
        for (Throwable t = cause; t != null; t = t.getCause()) {
            if (t instanceof java.sql.SQLException || t instanceof IllegalArgumentException) {
                return true;
            }
        }
        return false;
    }

    private static String rootMessage(Throwable cause) {
        Throwable t = cause;
        while (t.getCause() != null && t.getCause() != t) t = t.getCause();
        return t.getMessage() == null ? t.toString() : t.getMessage();
    }

    private static String stripTrailingSemicolon(String sql) {
        return sql.replaceAll(";\\s*$", "");
    }

    private static int clampMaxRows(Integer requested) {
        if (requested == null || requested <= 0) return DEFAULT_MAX_ROWS;
        return Math.min(requested, MAX_ROWS_CAP);
    }

    private static Response error(Response.Status status, String message) {
        return Response.status(status).entity(new SqlError(message)).type(MediaType.APPLICATION_JSON).build();
    }
}
