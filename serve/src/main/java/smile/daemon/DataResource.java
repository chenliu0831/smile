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
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;

/**
 * Serves the backing data for chart {@code ArrowRef}s as column-oriented JSON (the shape the
 * frontend ECharts adapter consumes).
 *
 * <p>A {@code ref} that names a table in the shared DuckDB session returns that table's
 * columns (bounded), so a chart can be backed by REAL data — a table the user saved or the
 * agent created. Otherwise it falls back to the small built-in demo tables
 * ({@code arrow-roc}/{@code arrow-shap}) used by the scripted/browser-dev run.
 *
 * <p>Endpoint: {@code GET /api/v1/data/{ref}?rows=N}.
 *
 * @author Haifeng Li
 */
@Path("/data")
public class DataResource {
    private static final org.jboss.logging.Logger LOG = org.jboss.logging.Logger.getLogger(DataResource.class);
    private static final int DEFAULT_ROWS = 5_000;
    private static final int MAX_ROWS = 50_000;

    /** Demo tables for the scripted/browser-dev run (no real daemon session). */
    private static final Map<String, Map<String, List<?>>> DEMO = Map.of(
        "arrow-roc", Map.of(
            "fpr", List.of(0.0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1.0),
            "tpr", List.of(0.0, 0.45, 0.6, 0.74, 0.82, 0.9, 0.95, 1.0)),
        "arrow-shap", Map.of(
            "feature", List.of("Contract", "tenure", "MonthlyCharges", "InternetService", "TotalCharges", "PaymentMethod"),
            "importance", List.of(0.31, 0.27, 0.14, 0.09, 0.07, 0.05))
    );

    /**
     * Returns the column table for a data reference: a shared-session DuckDB table if
     * {@code ref} is a safe table name that exists, else a built-in demo table.
     *
     * @param ref  the ArrowRef id or a shared-session table name.
     * @param rows row cap (default {@value #DEFAULT_ROWS}, max {@value #MAX_ROWS}).
     */
    @GET
    @Path("/{ref}")
    @Produces(MediaType.APPLICATION_JSON)
    public Map<String, ? extends List<?>> table(@PathParam("ref") String ref, @QueryParam("rows") Integer rows) {
        if (SessionTables.existsQuietly(ref)) {
            // The ref names a real session table — a projection failure here is a genuine
            // error (e.g. an unmappable column type), NOT "unknown ref"; surface it as 500
            // rather than masquerading as a 404.
            try {
                return SessionTables.columnTable(ref, SessionTables.columns(ref), clampRows(rows));
            } catch (Throwable t) {
                LOG.errorf("Failed to project session table %s: %s", ref, t.getMessage());
                throw new jakarta.ws.rs.InternalServerErrorException(
                    "Failed to read table '" + ref + "': " + t.getMessage());
            }
        }
        var demo = DEMO.get(ref);
        if (demo != null) return demo;
        throw new NotFoundException("Unknown data ref: " + ref);
    }

    private static int clampRows(Integer rows) {
        if (rows == null || rows <= 0) return DEFAULT_ROWS;
        return Math.min(rows, MAX_ROWS);
    }
}
