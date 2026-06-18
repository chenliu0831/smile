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
import jakarta.ws.rs.core.MediaType;

/**
 * Serves the backing data for chart/grid {@code ArrowRef}s emitted by a run
 * (ADR-0002). For V0 this returns column-oriented JSON tables (the shape the
 * frontend chart adapter consumes); the production path replaces the body with
 * binary Apache Arrow IPC frames behind the same {@code ref} addressing.
 *
 * <p>Endpoint: {@code GET /api/v1/data/{ref}}.
 *
 * @author Haifeng Li
 */
@Path("/data")
public class DataResource {

    /** Column-oriented tables keyed by ArrowRef id (stands in for Arrow frames). */
    private static final Map<String, Map<String, List<?>>> TABLES = Map.of(
        "arrow-roc", Map.of(
            "fpr", List.of(0.0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1.0),
            "tpr", List.of(0.0, 0.45, 0.6, 0.74, 0.82, 0.9, 0.95, 1.0)),
        "arrow-shap", Map.of(
            "feature", List.of("Contract", "tenure", "MonthlyCharges", "InternetService", "TotalCharges", "PaymentMethod"),
            "importance", List.of(0.31, 0.27, 0.14, 0.09, 0.07, 0.05))
    );

    /**
     * Returns the column table for a given data reference.
     *
     * @param ref the ArrowRef id (e.g. {@code arrow-roc}).
     * @return column-oriented JSON; 404 if unknown.
     */
    @GET
    @Path("/{ref}")
    @Produces(MediaType.APPLICATION_JSON)
    public Map<String, List<?>> table(@PathParam("ref") String ref) {
        var table = TABLES.get(ref);
        if (table == null) {
            throw new NotFoundException("Unknown data ref: " + ref);
        }
        return table;
    }
}
