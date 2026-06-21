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

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.networknt.schema.Error;
import com.networknt.schema.InputFormat;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * Cross-language contract conformance (Option B of the architecture review). Serializes the
 * daemon's actual wire records — using the SAME Jackson configuration {@link RunSocket} uses
 * — and validates each against the JSON Schema generated from the {@code @smile/contract}
 * TypeBox source of truth. If a Java record drifts from the shared contract (a renamed or
 * retyped field, a missing {@code @JsonProperty}), this test fails in CI.
 *
 * <p>The schema files live in the sibling contract module; their location is overridable via
 * {@code -Dsmile.contract.schema.dir} (CI sets it explicitly). Regenerate them with
 * {@code npm run gen} in {@code studio/contract} after any contract change.
 *
 * @author Haifeng Li
 */
public class ContractConformanceTest {

    /** The exact mapper RunSocket serializes with — picks up @JsonInclude(NON_NULL) on the interface. */
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * The generated-schema directory. Resolved robustly because Gradle may run this test from
     * the repo root OR the {@code serve/} module dir: try {@code -Dsmile.contract.schema.dir}
     * first, then the repo-root- and module-relative candidates.
     */
    private static final Path SCHEMA_DIR = resolveSchemaDir();

    private static Path resolveSchemaDir() {
        String override = System.getProperty("smile.contract.schema.dir");
        if (override != null) return Path.of(override);
        for (String candidate : new String[] {
                "studio/contract/schema",          // from repo root
                "../studio/contract/schema",       // from serve/
        }) {
            Path p = Path.of(candidate);
            if (Files.isReadable(p.resolve("DaemonMessage.json"))) return p;
        }
        // Fall back to the repo-root layout for a clear error message if none matched.
        return Path.of("studio/contract/schema");
    }

    // networknt 3.x: schemas + payloads are loaded as JSON STRINGS, so we never mix Jackson
    // versions — the daemon serializes with Jackson 2 (com.fasterxml) while networknt 3 uses
    // Jackson 3 (tools.jackson) internally; the string boundary keeps them cleanly separate.
    private static final SchemaRegistry REGISTRY =
            SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_7);

    /** Load a generated schema by name (e.g. "DaemonMessage"). */
    private static Schema schema(String name) {
        Path path = SCHEMA_DIR.resolve(name + ".json");
        if (!Files.isReadable(path)) {
            fail("Schema not found: " + path.toAbsolutePath()
                    + " — run `npm run gen` in studio/contract (or set -Dsmile.contract.schema.dir).");
        }
        try {
            return REGISTRY.getSchema(Files.readString(path), InputFormat.JSON);
        } catch (Exception e) {
            throw new RuntimeException("Failed to load schema " + name, e);
        }
    }

    /** Serialize {@code value} as the daemon would and assert it matches {@code schemaName}. */
    private static void assertConforms(String schemaName, Object value) {
        try {
            String json = MAPPER.writeValueAsString(value);
            List<Error> errors = schema(schemaName).validate(json, InputFormat.JSON);
            if (!errors.isEmpty()) {
                StringBuilder sb = new StringBuilder();
                sb.append(value.getClass().getSimpleName())
                  .append(" does not match ").append(schemaName).append(".json:\n");
                sb.append("  serialized: ").append(json).append('\n');
                for (Error m : errors) sb.append("  - ").append(m.getMessage()).append('\n');
                fail(sb.toString());
            }
        } catch (Exception e) {
            throw new RuntimeException("Conformance check failed for " + schemaName, e);
        }
    }

    // ---- DaemonMessage union: one representative per concrete record ----

    @Test
    public void sessionStartedConforms() {
        assertConforms("DaemonMessage", new DaemonMessage.SessionStarted("session-1", "Hi, I'm Clair."));
        // Null greeting: @JsonInclude(NON_NULL) drops it — the schema's optional field must allow that.
        assertConforms("DaemonMessage", new DaemonMessage.SessionStarted("session-1", null));
    }

    @Test
    public void runLifecycleMessagesConform() {
        var stage = new DaemonMessage.Stage("eda", "Exploratory Data Analysis",
                DaemonMessage.StageStatus.running, List.of("eda_report.md"), "5 candidates");
        assertConforms("DaemonMessage", new DaemonMessage.RunStarted("run-1", "Build the best model", List.of(stage)));
        assertConforms("DaemonMessage", new DaemonMessage.StageProgress("run-1", stage));
        assertConforms("DaemonMessage", new DaemonMessage.RunFinished("run-1", "completed"));
    }

    @Test
    public void turnAndChunkMessagesConform() {
        assertConforms("DaemonMessage", new DaemonMessage.TurnStarted("turn-1", "agent"));
        assertConforms("DaemonMessage", new DaemonMessage.TurnFinished("turn-1", "done", 1234L));
        assertConforms("DaemonMessage", new DaemonMessage.AgentChunk("run-1", "streaming text"));
    }

    @Test
    public void toolCallAndTodoMessagesConform() {
        // A tool-call card with optional fields present...
        var full = new DaemonMessage.ToolCall("tc-1", "Ran candidate_lgbm.py", "script", "done",
                "print('x')", "AUC 0.91", "0.91");
        assertConforms("DaemonMessage", new DaemonMessage.ToolCallMsg("run-1", full));
        // ...and with the nullable fields null (nested record => serialized as explicit null).
        var sparse = new DaemonMessage.ToolCall("tc-2", "Read churn.csv", "read", "running",
                null, null, null);
        assertConforms("DaemonMessage", new DaemonMessage.ToolCallMsg("run-1", sparse));
        var todo = new DaemonMessage.Todo("Train models", "in_progress", "Training models");
        assertConforms("DaemonMessage", new DaemonMessage.TodoList("run-1", List.of(todo)));
    }

    @Test
    public void artifactMessagesConform() {
        // Report artifact with null viz/data (the exact shape the live summarize run emits).
        var report = new DaemonMessage.Artifact("freeform:summary.md", "report", "Data Summary",
                "# Summary\n...", null, null, "/tmp/work/summary.md");
        assertConforms("DaemonMessage", new DaemonMessage.ArtifactMsg("run-1", report));
        // Chart artifact carrying a DataVizSpec + ArrowRef.
        var arrow = new DaemonMessage.ArrowRef("arrow", "arrow-roc", 8, 2);
        var viz = new DaemonMessage.DataVizSpec("line", "ROC", Map.of("x", "fpr", "y", "tpr"), arrow);
        var chart = new DaemonMessage.Artifact("chart:roc", "chart", "ROC Curve", null, viz, arrow, null);
        assertConforms("DaemonMessage", new DaemonMessage.ArtifactMsg("run-1", chart));
    }

    @Test
    public void gateMessagesConform() {
        var q = new DaemonMessage.Question("g-1", "Primary metric", "Which metric?",
                List.of("AUC", "Accuracy"), true);
        assertConforms("DaemonMessage", new DaemonMessage.GateOpened("run-1", new DaemonMessage.Gate("g-1", "clarify", "Primary metric", q)));
        // Approval gate with a null question (nested null).
        assertConforms("DaemonMessage", new DaemonMessage.GateOpened("run-1", new DaemonMessage.Gate("g-2", "approval", "Run GPU NAS", null)));
        assertConforms("DaemonMessage", new DaemonMessage.GateClosed("run-1", "g-1"));
    }

    // ---- REST JSON shapes ----

    @Test
    public void restExecAndErrorConform() {
        assertConforms("ExecResult", new SqlResource.ExecResult("ddl", true, null, List.of("titanic")));
        assertConforms("ExecResult", new SqlResource.ExecResult("dml", true, 3, List.of()));
        assertConforms("SqlError", new SqlResource.SqlError("Catalog Error: no such table"));
    }

    @Test
    public void restDatasetAndTablesConform() {
        var col = new DatasetResource.ColumnInfo("PassengerId", "int");
        var preview = Map.<String, List<Object>>of("PassengerId", List.of(1, 2, 3));
        assertConforms("DatasetInfo", new DatasetResource.DatasetInfo("titanic.csv", 891, 12, List.of(col), preview));

        var tcol = new TablesResource.ColumnInfo("PassengerId", "BIGINT");
        assertConforms("TableInfo", new TablesResource.TableInfo("titanic", List.of(tcol), null));
        assertConforms("TableInfo", new TablesResource.TableInfo("survivors", List.of(tcol), "SELECT * FROM titanic WHERE Survived = 1"));
    }

    @Test
    public void schemaDirIsPresent() {
        // Guards against a silent skip if the path is wrong: at least DaemonMessage must exist.
        assertTrue(Files.isReadable(SCHEMA_DIR.resolve("DaemonMessage.json")),
                "Expected generated schema at " + SCHEMA_DIR.toAbsolutePath());
    }
}
