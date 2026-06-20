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
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import ioa.llm.tool.SharedSql;
import ioa.llm.tool.ToolException;

/**
 * The schema rail backend (SQL-driven exploration, Phase 2): lists the tables/views in the
 * shared DuckDB session with their columns and — where the daemon recorded it — the SQL that
 * defines a derived table. Drives the SQL console's left rail so switching/joining tables is
 * recognition, not recall. Sees both the user's tables and the agent's, since they share one
 * session.
 *
 * <p>Endpoint: {@code GET /api/v1/tables}.
 *
 * @author Haifeng Li
 */
@Path("/tables")
public class TablesResource {
    private static final org.jboss.logging.Logger LOG = org.jboss.logging.Logger.getLogger(TablesResource.class);

    /** One column of a table. */
    public record ColumnInfo(String name, String type) {}

    /** A table/view: name, columns, and (if known) its defining SQL. */
    public record TableInfo(String name, List<ColumnInfo> columns, String definition) {}

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response list() {
        try {
            // tables() filters internal tables; allColumns() reads every column in ONE query
            // (vs the old N+1 DESCRIBE-per-table, each taking the shared lock separately).
            var byTable = SharedSql.allColumns();
            List<TableInfo> out = new ArrayList<>();
            for (String name : SharedSql.tables()) {
                List<ColumnInfo> cols = new ArrayList<>();
                for (SharedSql.Column c : byTable.getOrDefault(name, List.of())) {
                    cols.add(new ColumnInfo(c.name(), c.type()));
                }
                out.add(new TableInfo(name, cols, SqlLineage.definitionOf(name)));
            }
            return Response.ok(out).build();
        } catch (ToolException e) {
            LOG.error("Failed to list tables", e);
            return Response.serverError().entity(new SqlResource.SqlError(e.getMessage())).build();
        }
    }
}
