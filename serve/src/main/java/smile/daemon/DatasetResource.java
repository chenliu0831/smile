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

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import ioa.llm.tool.SharedSql.Column;
import ioa.llm.tool.ToolException;

/**
 * Native dataset insights — schema, row/column counts, and a bounded preview for a NAMED
 * table in the shared DuckDB session. This gives the UI (and the agent) a true view of a
 * real, imported table's schema + values, projected straight from DuckDB.
 *
 * <p>Deliberately NOT a filesystem scan. The previous version returned "the first file in
 * {@code <cwd>/input/}", which made a stale leftover file masquerade as a loaded dataset
 * (and coupled "loaded" to the daemon's working directory). "Loaded" now means a real
 * queryable session table — the same source of truth as {@link TablesResource} — created by
 * an explicit import (CREATE TABLE … read_csv via {@code /sql}) or by the agent.
 *
 * <p>Endpoint: {@code GET /api/v1/dataset?table=NAME&rows=N&full=true}.
 *
 * @author Haifeng Li
 */
@jakarta.ws.rs.Path("/dataset")
public class DatasetResource {
    private static final org.jboss.logging.Logger LOG = org.jboss.logging.Logger.getLogger(DatasetResource.class);
    private static final int MAX_PREVIEW_ROWS = 1000;
    /** Cap for the explorer's full-data fetch — protects the daemon/browser from huge frames. */
    private static final int MAX_FULL_ROWS = 50_000;

    /** Schema info for one column. */
    public record ColumnInfo(String name, String type) {}

    /** The dataset summary + preview returned to the UI. */
    public record DatasetInfo(
            /** The session table name (shown as the dataset name in the UI). */
            String fileName,
            int nrow,
            int ncol,
            List<ColumnInfo> columns,
            /** Column-oriented preview: column name -> up to MAX_PREVIEW_ROWS values. */
            Map<String, List<Object>> preview) {}

    /**
     * Returns schema + a bounded preview for the named session table, projected from DuckDB.
     *
     * @param table the session table name (a plain SQL identifier). Required.
     * @param rows  preview row cap (default {@value #MAX_PREVIEW_ROWS}).
     * @param full  when true, return up to {@value #MAX_FULL_ROWS} rows for the explorer
     *              (live pivot/filter/aggregate needs the whole frame, not a preview).
     */
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public DatasetInfo dataset(@QueryParam("table") String table,
                               @QueryParam("rows") Integer rows,
                               @QueryParam("full") boolean full) {
        if (table == null || table.isBlank()) {
            throw new BadRequestException("Query parameter 'table' is required.");
        }
        if (!SessionTables.isValidIdentifier(table)) {
            throw new BadRequestException("Invalid table name: " + table);
        }
        try {
            if (!SessionTables.exists(table)) {
                throw new NotFoundException("No such table in the session: " + table);
            }
            List<Column> cols = SessionTables.columns(table);
            List<ColumnInfo> columns = new ArrayList<>(cols.size());
            for (Column c : cols) {
                columns.add(new ColumnInfo(c.name(), c.type()));
            }

            int cap = full ? MAX_FULL_ROWS : MAX_PREVIEW_ROWS;
            int limit = Math.min(rows != null && rows > 0 ? rows : cap, cap);
            // Column-oriented preview straight from the DuckDB session.
            Map<String, List<Object>> preview = SessionTables.columnTable(table, cols, limit);

            // nrow = rows in the preview (the first column's length; columnTable returns
            // equal-length columns). For the default cap (1000) this is the true count for any
            // table up to that size, and "rows shown" for larger ones — accurate for the chip's
            // typical imported-dataset case without a separate COUNT(*) round-trip.
            int nrow = preview.values().stream().findFirst().map(List::size).orElse(0);
            return new DatasetInfo(table, nrow, columns.size(), columns, preview);
        } catch (NotFoundException | BadRequestException e) {
            throw e;
        } catch (ToolException e) {
            LOG.errorf("Failed to project table %s: %s", table, e.getMessage());
            throw new NotFoundException("Failed to read table '" + table + "': " + e.getMessage());
        }
    }
}
