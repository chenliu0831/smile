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

import java.io.ByteArrayInputStream;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import smile.data.DataFrame;
import smile.io.Arrow;
import static io.restassured.RestAssured.given;
import static org.hamcrest.CoreMatchers.containsString;
import static org.hamcrest.CoreMatchers.hasItem;
import static org.hamcrest.CoreMatchers.is;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Integration tests for {@link SqlResource}: the SQL console endpoint backed by the
 * shared DuckDB session (Phase 1). Because the Quarkus test JVM is the same JVM that
 * hosts the ioa agent's static {@code smile.data.SQL} singleton, a table created here
 * via {@code /sql} is the very table the agent would see — so these tests also exercise
 * the shared-session bridge ({@link ioa.llm.tool.SharedSql}).
 *
 * <p>Ordered so the CREATE TABLE that later SELECTs depend on runs first.
 */
@QuarkusTest
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
public class SqlResourceTest {

    private static final String ARROW = "application/vnd.apache.arrow.stream";

    /** POST a SQL statement, returning the raw RestAssured response. */
    private static Response post(String sql) {
        return given().contentType(ContentType.JSON).body("{\"sql\":" + quote(sql) + "}")
                .when().post("/api/v1/sql");
    }

    private static String quote(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    /** Reads an Arrow IPC stream response body back into a DataFrame to assert on it. */
    private static DataFrame readArrow(Response r) throws Exception {
        byte[] body = r.then().statusCode(200).contentType(ARROW).extract().body().asByteArray();
        return new Arrow().read(new ByteArrayInputStream(body), Integer.MAX_VALUE);
    }

    @Test
    @Order(1)
    public void selectReturnsArrowStreamWithRowAndColHeaders() throws Exception {
        Response r = post("SELECT 42 AS x, 'hi' AS y");
        DataFrame df = readArrow(r);
        assertEquals(1, df.nrow());
        assertEquals(2, df.ncol());
        assertEquals(42, ((Number) df.get(0, 0)).intValue());
        r.then().header("X-Smile-Rows", is("1")).header("X-Smile-Cols", is("2"));
    }

    @Test
    @Order(2)
    public void createTableThenSelectProvesSharedSession() throws Exception {
        // DDL: create a table on the shared DuckDB session.
        post("CREATE OR REPLACE TABLE smile_test_t AS SELECT * FROM range(5) AS r(i)")
                .then().statusCode(200).contentType(ContentType.JSON)
                .body("ok", is(true));

        // The same singleton the agent uses now sees the table directly (shared session).
        assertTrue(ioa.llm.tool.SharedSql.tables().contains("smile_test_t"));

        // And a later /sql SELECT can read it back.
        DataFrame df = readArrow(post("SELECT COUNT(*) AS c FROM smile_test_t"));
        assertEquals(5L, ((Number) df.get(0, 0)).longValue());
    }

    @Test
    @Order(3)
    public void selectIsBoundedByMaxRows() throws Exception {
        Response r = given().contentType(ContentType.JSON)
                .body("{\"sql\":\"SELECT * FROM range(1000) AS r(i)\",\"maxRows\":10}")
                .when().post("/api/v1/sql");
        DataFrame df = readArrow(r);
        assertEquals(10, df.nrow());
        r.then().header("X-Smile-Truncated", is("true"));
    }

    @Test
    @Order(3)
    public void exactlyMaxRowsIsNotReportedAsTruncated() throws Exception {
        // A result whose true size == maxRows must NOT be flagged truncated (off-by-one:
        // we fetch maxRows+1 and only truncate when MORE than maxRows came back).
        Response r = given().contentType(ContentType.JSON)
                .body("{\"sql\":\"SELECT * FROM range(10) AS r(i)\",\"maxRows\":10}")
                .when().post("/api/v1/sql");
        DataFrame df = readArrow(r);
        assertEquals(10, df.nrow());
        r.then().header("X-Smile-Truncated", is("false"));
    }

    @Test
    @Order(3)
    public void fromFirstQueryIsRoutedAsAQueryNotDiscarded() throws Exception {
        // DuckDB FROM-first syntax returns rows; it must stream Arrow, not fall through to
        // execute() (which would discard the result set and return JSON).
        DataFrame df = readArrow(post("FROM range(3)"));
        assertEquals(3, df.nrow());
    }

    @Test
    @Order(3)
    public void queryWithTrailingLineCommentStillRuns() throws Exception {
        // The LIMIT-wrap must survive a trailing single-line comment with no newline.
        DataFrame df = readArrow(post("SELECT 1 AS a -- trailing comment"));
        assertEquals(1, df.nrow());
    }

    @Test
    @Order(4)
    public void compositeHugeintResultDoesNotErrorOut() throws Exception {
        // SUM over BIGINT yields HUGEINT (JDBCType OTHER), which the result bridge can't
        // map — the endpoint must CAST it to VARCHAR and still return 200, not 500.
        DataFrame df = readArrow(post("SELECT SUM(i) AS total FROM range(100) AS r(i)"));
        assertEquals(1, df.nrow());
        assertEquals("4950", String.valueOf(df.get(0, 0)));
    }

    @Test
    @Order(5)
    public void compositeListResultDoesNotErrorOut() throws Exception {
        // A LIST column ([]) is unmappable; CAST-to-VARCHAR fallback must keep it 200.
        DataFrame df = readArrow(post("SELECT [1, 2, 3] AS l"));
        assertEquals(1, df.nrow());
        assertTrue(String.valueOf(df.get(0, 0)).contains("1"));
    }

    @Test
    @Order(6)
    public void syntacticallyInvalidSqlReturns400() {
        post("SELECT FROM WHERE").then().statusCode(400).contentType(ContentType.JSON);
    }

    @Test
    @Order(7)
    public void multipleStatementsRejectedAsBadRequest() {
        // base SQL.requireSingleStatement forbids statement stacking.
        post("SELECT 1; DROP TABLE smile_test_t").then().statusCode(400);
    }

    @Test
    @Order(8)
    public void emptySqlReturns400() {
        post("   ").then().statusCode(400);
    }

    // ---- Phase 2: schema rail (/tables) + save-as-table (/sql/save) ----

    @Test
    @Order(9)
    public void saveAsTableCreatesChainableTableVisibleToAgent() {
        // Save a SELECT as a real table.
        given().contentType(ContentType.JSON)
                .body("{\"name\":\"smile_saved\",\"select\":\"SELECT * FROM range(3) AS r(i)\"}")
                .when().post("/api/v1/sql/save")
                .then().statusCode(200).contentType(ContentType.JSON)
                .body("ok", is(true))
                .body("tables", hasItem("smile_saved"));
        // The agent's shared session sees it; it chains (queryable by a later statement).
        assertTrue(ioa.llm.tool.SharedSql.tables().contains("smile_saved"));
    }

    @Test
    @Order(9)
    public void saveRejectsUnsafeTableName() {
        given().contentType(ContentType.JSON)
                .body("{\"name\":\"x; DROP TABLE y\",\"select\":\"SELECT 1\"}")
                .when().post("/api/v1/sql/save")
                .then().statusCode(400);
    }

    @Test
    @Order(11)
    public void saveToExistingNameReturns409WithoutOverwrite() {
        // First save creates a fresh table.
        given().contentType(ContentType.JSON)
                .body("{\"name\":\"smile_collide\",\"select\":\"SELECT 1 AS a\"}")
                .when().post("/api/v1/sql/save")
                .then().statusCode(200);
        // A second save of the same name WITHOUT overwrite must NOT clobber it → 409.
        given().contentType(ContentType.JSON)
                .body("{\"name\":\"smile_collide\",\"select\":\"SELECT 99 AS z\"}")
                .when().post("/api/v1/sql/save")
                .then().statusCode(409);
        // overwrite:true replaces it.
        given().contentType(ContentType.JSON)
                .body("{\"name\":\"smile_collide\",\"select\":\"SELECT 99 AS z\",\"overwrite\":true}")
                .when().post("/api/v1/sql/save")
                .then().statusCode(200).body("ok", is(true));
    }

    @Test
    @Order(12)
    public void dropForgetsLineage() {
        // Create with lineage, drop it, recreate WITHOUT a recorded definition → the rail
        // must not show the old definition.
        post("CREATE OR REPLACE TABLE smile_drop_t AS SELECT 1 AS a").then().statusCode(200);
        post("DROP TABLE smile_drop_t").then().statusCode(200);
        given().when().get("/api/v1/tables")
                .then().statusCode(200)
                .body("findAll { it.name == 'smile_drop_t' }", org.hamcrest.Matchers.hasSize(0));
    }

    @Test
    @Order(10)
    public void tablesEndpointListsColumnsAndLineage() {
        // smile_saved was created via /sql/save above, so its lineage (defining SQL) is known.
        given().when().get("/api/v1/tables")
                .then().statusCode(200).contentType(ContentType.JSON)
                .body("name", hasItem("smile_saved"))
                .body("find { it.name == 'smile_saved' }.columns.name", hasItem("i"))
                .body("find { it.name == 'smile_saved' }.definition", containsString("range(3)"));
    }
}
