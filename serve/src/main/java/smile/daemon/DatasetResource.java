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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import smile.data.DataFrame;
import smile.data.type.StructType;
import smile.io.Read;

/**
 * Native dataset insights (P3): loads the dataset in the daemon's working dir
 * {@code input/} via {@link smile.io.Read#data} and serves its schema, row/column
 * counts, and a bounded preview as JSON. This gives the UI (and, when wired, the agent)
 * a TRUE view of the data — schema and real values — instead of relying on the LLM to
 * read raw CSV text (which the smaller models do unreliably).
 *
 * <p>Endpoints under {@code /api/v1}:
 * <ul>
 *   <li>{@code GET /dataset} — schema + nrow/ncol + a preview slice (column-oriented JSON
 *       the frontend feeds straight into the Perspective grid via its Arrow seam).</li>
 * </ul>
 *
 * @author Haifeng Li
 */
@jakarta.ws.rs.Path("/dataset")
public class DatasetResource {
    private static final org.jboss.logging.Logger LOG = org.jboss.logging.Logger.getLogger(DatasetResource.class);
    private static final int MAX_PREVIEW_ROWS = 1000;

    /** Schema info for one column. */
    public record ColumnInfo(String name, String type) {}

    /** The dataset summary + preview returned to the UI. */
    public record DatasetInfo(
            String fileName,
            int nrow,
            int ncol,
            List<ColumnInfo> columns,
            /** Column-oriented preview: column name -> up to MAX_PREVIEW_ROWS values. */
            Map<String, List<Object>> preview) {}

    /**
     * Loads the single dataset in {@code <cwd>/input/} and returns its insights.
     *
     * @param rows preview row cap (default {@value #MAX_PREVIEW_ROWS}).
     */
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public DatasetInfo dataset(@QueryParam("rows") Integer rows) {
        Path file = findDataset();
        if (file == null) {
            throw new NotFoundException("No dataset found in input/");
        }
        try {
            DataFrame df = load(file);
            int limit = Math.min(rows != null && rows > 0 ? rows : MAX_PREVIEW_ROWS, MAX_PREVIEW_ROWS);
            limit = Math.min(limit, df.nrow());

            StructType schema = df.schema();
            String[] names = schema.names();
            var dtypes = schema.dtypes();
            List<ColumnInfo> columns = new ArrayList<>(names.length);
            for (int j = 0; j < names.length; j++) {
                columns.add(new ColumnInfo(names[j], dtypes[j].name()));
            }

            DataFrame head = limit < df.nrow() ? df.slice(0, limit) : df;
            Map<String, List<Object>> preview = new LinkedHashMap<>();
            for (String name : names) {
                var vec = head.column(name);
                List<Object> values = new ArrayList<>(head.nrow());
                for (int i = 0; i < head.nrow(); i++) {
                    values.add(vec.get(i));
                }
                preview.put(name, values);
            }

            return new DatasetInfo(file.getFileName().toString(), df.nrow(), df.ncol(), columns, preview);
        } catch (Exception e) {
            LOG.errorf("Failed to load dataset %s: %s", file, e.getMessage());
            throw new NotFoundException("Failed to load dataset: " + e.getMessage());
        }
    }

    /**
     * Loads a dataset, honoring CSV/TSV headers. {@code Read.data} defaults CSV to
     * no-header, all-String (which would treat the header row as data); for delimited
     * text we request {@code header=true} so column names and types are inferred.
     */
    private static DataFrame load(Path file) throws Exception {
        String name = file.getFileName().toString().toLowerCase();
        if (name.endsWith(".csv")) {
            return Read.csv(file.toString(), "header=true");
        }
        if (name.endsWith(".tsv")) {
            return Read.csv(file.toString(), "delimiter=\t,header=true");
        }
        return Read.data(file.toString());
    }

    /** Finds the first regular file under {@code <cwd>/input/}. */
    private static Path findDataset() {
        Path inputDir = Path.of(System.getProperty("user.dir"), "input");
        if (!Files.isDirectory(inputDir)) return null;
        try (Stream<Path> files = Files.list(inputDir)) {
            return files.filter(Files::isRegularFile).findFirst().orElse(null);
        } catch (IOException e) {
            return null;
        }
    }
}
