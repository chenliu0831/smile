/*
 * Copyright (c) 2010-2026 Haifeng Li. All rights reserved.
 *
 * SMILE is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * SMILE is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with SMILE. If not, see <https://www.gnu.org/licenses/>.
 */
package smile.data;

import java.sql.SQLException;
import java.util.Map;
import smile.io.Paths;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for {@link SQL}, including SQL-injection regression tests.
 *
 * @author Haifeng Li
 */
public class SQLTest {

    public SQLTest() {
    }

    @BeforeAll
    public static void setUpClass() throws Exception {
    }

    @AfterAll
    public static void tearDownClass() throws Exception {
    }

    @BeforeEach
    public void setUp() {
    }

    @AfterEach
    public void tearDown() {
    }

    @Test
    public void test() throws SQLException {
        System.out.println("SQL");
        SQL sql = new SQL();
        sql.parquet("user", Paths.getTestData("kylo/userdata1.parquet").toString());
        sql.json("books", Paths.getTestData("kylo/books_array.json").toString());
        sql.csv("gdp", Paths.getTestData("regression/gdp.csv").toString());
        sql.csv("diabetes", Paths.getTestData("regression/diabetes.csv").toString());

        DataFrame tables = sql.tables();
        System.out.println(tables);
        assertEquals(4, tables.size());

        DataFrame columns = sql.describe("user");
        System.out.println(columns.head(100));
        assertEquals(13, columns.size());

        columns = sql.describe("books");
        System.out.println(columns.head(100));
        assertEquals(10, columns.size());

        columns = sql.describe("gdp");
        System.out.println(columns.head(100));
        assertEquals(4, columns.size());

        columns = sql.describe("diabetes");
        System.out.println(columns.head(100));
        assertEquals(65, columns.size());

        DataFrame user = sql.query("SELECT * FROM user");
        assertEquals(1000, user.size());
        assertEquals(13, user.columns().size());

        DataFrame join = sql.query("SELECT * FROM user LEFT JOIN gdp ON user.country = gdp.Country");
        System.out.println(join.head(100));
        assertEquals(user.size(), join.size());
        assertEquals(17, join.columns().size());
        sql.close();
    }

    // -----------------------------------------------------------------------
    // requireSafeIdentifier – allow-list validation
    // -----------------------------------------------------------------------

    @Test
    public void testSafeIdentifierAcceptsSimpleName() {
        System.out.println("requireSafeIdentifier – simple name");
        // Given / When / Then
        assertEquals("my_table", SQL.requireSafeIdentifier("my_table"));
        assertEquals("T1",       SQL.requireSafeIdentifier("T1"));
        assertEquals("_hidden",  SQL.requireSafeIdentifier("_hidden"));
    }

    @Test
    public void testSafeIdentifierRejectsSpaces() {
        System.out.println("requireSafeIdentifier – space in name");
        assertThrows(IllegalArgumentException.class,
                () -> SQL.requireSafeIdentifier("my table"));
    }

    @Test
    public void testSafeIdentifierRejectsSemicolon() {
        System.out.println("requireSafeIdentifier – semicolon stacking");
        // Classic stacked-statement injection: "t; DROP TABLE users--"
        assertThrows(IllegalArgumentException.class,
                () -> SQL.requireSafeIdentifier("t; DROP TABLE users--"));
    }

    @Test
    public void testSafeIdentifierRejectsQuote() {
        System.out.println("requireSafeIdentifier – quote-breaking attempt");
        // Attempt to break out of a quoted identifier context
        assertThrows(IllegalArgumentException.class,
                () -> SQL.requireSafeIdentifier("t' OR '1'='1"));
    }

    @Test
    public void testSafeIdentifierRejectsDash() {
        System.out.println("requireSafeIdentifier – SQL comment sequence");
        // "--" starts a SQL comment; a name containing it is malicious
        assertThrows(IllegalArgumentException.class,
                () -> SQL.requireSafeIdentifier("t--comment"));
    }

    @Test
    public void testSafeIdentifierRejectsLeadingDigit() {
        System.out.println("requireSafeIdentifier – leading digit");
        assertThrows(IllegalArgumentException.class,
                () -> SQL.requireSafeIdentifier("1table"));
    }

    @Test
    public void testSafeIdentifierRejectsNull() {
        System.out.println("requireSafeIdentifier – null input");
        assertThrows(IllegalArgumentException.class,
                () -> SQL.requireSafeIdentifier(null));
    }

    @Test
    public void testSafeIdentifierRejectsEmpty() {
        System.out.println("requireSafeIdentifier – empty string");
        assertThrows(IllegalArgumentException.class,
                () -> SQL.requireSafeIdentifier(""));
    }

    // -----------------------------------------------------------------------
    // escape – single-quote doubling
    // -----------------------------------------------------------------------

    @Test
    public void testEscapeDoublesQuotes() {
        System.out.println("escape – single-quote doubling");
        // Given a path containing a single-quote (quote-breaking attempt)
        // When
        String escaped = SQL.escape("file'with'quotes.csv");
        // Then no bare single-quote remains
        assertEquals("file''with''quotes.csv", escaped);
    }

    @Test
    public void testEscapeNullReturnsEmpty() {
        System.out.println("escape – null returns empty string");
        assertEquals("", SQL.escape(null));
    }

    // -----------------------------------------------------------------------
    // requireSafeLiteral – dangerous character rejection
    // -----------------------------------------------------------------------

    @Test
    public void testSafeLiteralRejectsSemicolon() {
        System.out.println("requireSafeLiteral – semicolon stacking");
        // A path ending with "; DROP TABLE users" is rejected
        assertThrows(IllegalArgumentException.class,
                () -> SQL.requireSafeLiteral("/data/file.csv; DROP TABLE users"));
    }

    @Test
    public void testSafeLiteralRejectsLineTerminator() {
        System.out.println("requireSafeLiteral – newline payload");
        assertThrows(IllegalArgumentException.class,
                () -> SQL.requireSafeLiteral("/data/file.csv\nDROP TABLE users"));
    }

    @Test
    public void testSafeLiteralRejectsCarriageReturn() {
        System.out.println("requireSafeLiteral – carriage-return payload");
        assertThrows(IllegalArgumentException.class,
                () -> SQL.requireSafeLiteral("/data/file.csv\rEVIL"));
    }

    @Test
    public void testSafeLiteralRejectsSqlLineComment() {
        System.out.println("requireSafeLiteral – SQL line-comment sequence");
        assertThrows(IllegalArgumentException.class,
                () -> SQL.requireSafeLiteral("/data/file.csv'--"));
    }

    @Test
    public void testSafeLiteralRejectsBlockComment() {
        System.out.println("requireSafeLiteral – SQL block-comment sequence");
        assertThrows(IllegalArgumentException.class,
                () -> SQL.requireSafeLiteral("/data/file.csv'/*evil*/"));
    }

    @Test
    public void testSafeLiteralRejectsNulByte() {
        System.out.println("requireSafeLiteral – NUL byte truncation attack");
        assertThrows(IllegalArgumentException.class,
                () -> SQL.requireSafeLiteral("/data/file\u0000.csv"));
    }

    @Test
    public void testSafeLiteralAcceptsNormalPath() {
        System.out.println("requireSafeLiteral – normal file path accepted");
        // A typical file path with spaces, dots, slashes, and hyphens is fine
        String path = "/home/user/data-files/my_data.csv";
        assertEquals(path, SQL.requireSafeLiteral(path));
    }

    @Test
    public void testSafeLiteralAcceptsWindowsPath() {
        System.out.println("requireSafeLiteral – Windows path accepted");
        String path = "C:\\\\Users\\\\data\\\\file.csv";
        assertEquals(path, SQL.requireSafeLiteral(path));
    }

    // -----------------------------------------------------------------------
    // csv() – injection through table name and path
    // -----------------------------------------------------------------------

    @Test
    public void testCsvRejectsInjectedTableName() throws SQLException {
        System.out.println("csv() – injected table name is rejected");
        // Given an in-memory SQL instance
        try (SQL sql = new SQL()) {
            // When / Then – table name contains a semicolon (stacked statement)
            assertThrows(IllegalArgumentException.class,
                    () -> sql.csv("t; DROP TABLE users--", "/some/file.csv"));
        }
    }

    @Test
    public void testCsvRejectsPathWithSemicolon() throws SQLException {
        System.out.println("csv() – path with semicolon is rejected");
        try (SQL sql = new SQL()) {
            assertThrows(IllegalArgumentException.class,
                    () -> sql.csv("mytable", "/path/to/file.csv; DROP TABLE mytable"));
        }
    }

    @Test
    public void testCsvRejectsPathWithNewline() throws SQLException {
        System.out.println("csv() – path with newline is rejected");
        try (SQL sql = new SQL()) {
            assertThrows(IllegalArgumentException.class,
                    () -> sql.csv("mytable", "/path/to/file.csv\nDROP TABLE mytable"));
        }
    }

    @Test
    public void testCsvColumnListRejectsInjectedKey() throws SQLException {
        System.out.println("csv() – columnList key with semicolon is rejected");
        try (SQL sql = new SQL()) {
            Map<String, String> cols = Map.of("col; DROP TABLE x--", "VARCHAR");
            assertThrows(IllegalArgumentException.class,
                    () -> sql.csv("mytable", ',', cols, "/some/file.csv"));
        }
    }

    @Test
    public void testCsvColumnListRejectsInjectedValue() throws SQLException {
        System.out.println("csv() – columnList value with comment sequence is rejected");
        try (SQL sql = new SQL()) {
            Map<String, String> cols = Map.of("col", "VARCHAR'--");
            assertThrows(IllegalArgumentException.class,
                    () -> sql.csv("mytable", ',', cols, "/some/file.csv"));
        }
    }

    // -----------------------------------------------------------------------
    // parquet() – injection through table name
    // -----------------------------------------------------------------------

    @Test
    public void testParquetRejectsInjectedTableName() throws SQLException {
        System.out.println("parquet() – injected table name is rejected");
        try (SQL sql = new SQL()) {
            assertThrows(IllegalArgumentException.class,
                    () -> sql.parquet("t' OR '1'='1", "/some/file.parquet"));
        }
    }

    // -----------------------------------------------------------------------
    // json() – injection through format string
    // -----------------------------------------------------------------------

    @Test
    public void testJsonRejectsInjectedFormat() throws SQLException {
        System.out.println("json() – injected format string is rejected");
        try (SQL sql = new SQL()) {
            assertThrows(IllegalArgumentException.class,
                    () -> sql.json("mytable", "auto'; DROP TABLE mytable--",
                            (Map<String, String>) null, "/some/file.json"));
        }
    }

    // -----------------------------------------------------------------------
    // optionList – injection through option key and value
    // -----------------------------------------------------------------------

    @Test
    public void testOptionListRejectsInjectedKey() throws SQLException {
        System.out.println("parquet() option – unsafe key is rejected");
        try (SQL sql = new SQL()) {
            // option key must satisfy SAFE_IDENTIFIER (letters/digits/underscores)
            Map<String, String> opts = Map.of("opt; DROP TABLE x", "true");
            assertThrows(IllegalArgumentException.class,
                    () -> sql.parquet("mytable", opts, "/some/file.parquet"));
        }
    }

    @Test
    public void testOptionListRejectsInjectedValue() throws SQLException {
        System.out.println("parquet() option – unsafe value is rejected");
        try (SQL sql = new SQL()) {
            Map<String, String> opts = Map.of("hive_partitioning", "true\nDROP TABLE x");
            assertThrows(IllegalArgumentException.class,
                    () -> sql.parquet("mytable", opts, "/some/file.parquet"));
        }
    }

    // -----------------------------------------------------------------------
    // Concurrency – one shared SQL instance is used by multiple threads
    // (the interactive UI and the agent share the agent's singleton). The
    // single JDBC Connection's transaction state is not safe under concurrent
    // statements, so query/update/execute are synchronized; this asserts that
    // heavy concurrent use neither throws nor corrupts results.
    // -----------------------------------------------------------------------

    @Test
    public void testQueryTimeoutAbortsRunawayStatement() throws Exception {
        System.out.println("SQL – queryTimeout aborts a runaway statement (releases the lock)");
        try (SQL sql = new SQL()) {
            sql.queryTimeout(1); // 1 second
            long start = System.currentTimeMillis();
            // A deliberately expensive cross join that would run far longer than 1s.
            assertThrows(SQLException.class, () ->
                    sql.query("SELECT COUNT(*) FROM range(100000000) a, range(100000000) b"));
            long elapsed = System.currentTimeMillis() - start;
            // The driver should abort within a few seconds, not run to completion.
            assertTrue(elapsed < 20_000, "query should have been cancelled quickly, took " + elapsed + "ms");
            // The instance is still usable afterwards (lock released, connection intact).
            assertEquals(1L, ((Number) sql.query("SELECT 1 AS x").get(0, 0)).longValue());
        }
    }

    @Test
    public void testConcurrentStatementsAreSerialized() throws Exception {
        System.out.println("SQL – concurrent statements on a shared instance are serialized");
        try (SQL sql = new SQL()) {
            sql.execute("CREATE TABLE t AS SELECT * FROM range(1000) AS r(i)");

            int threads = 8;
            int iterations = 40;
            var pool = java.util.concurrent.Executors.newFixedThreadPool(threads);
            var errors = new java.util.concurrent.ConcurrentLinkedQueue<Throwable>();
            var tasks = new java.util.ArrayList<java.util.concurrent.Callable<Void>>();
            for (int n = 0; n < threads; n++) {
                final int id = n;
                tasks.add(() -> {
                    try {
                        for (int k = 0; k < iterations; k++) {
                            if (id % 2 == 0) {
                                // Readers: the count must always be exactly 1000.
                                DataFrame df = sql.query("SELECT COUNT(*) AS c FROM t");
                                long c = ((Number) df.get(0, 0)).longValue();
                                if (c != 1000) errors.add(new AssertionError("expected 1000, got " + c));
                            } else {
                                // Writers: a per-thread derived table via DDL + a SELECT.
                                // CAST the SUM to BIGINT: DuckDB's SUM(BIGINT) yields HUGEINT
                                // (JDBCType OTHER) which the result bridge doesn't map — that
                                // composite-type handling is the /sql endpoint's job, not this
                                // concurrency test's.
                                sql.execute("CREATE OR REPLACE TABLE d_" + id
                                        + " AS SELECT i, i*2 AS j FROM t WHERE i < 10");
                                sql.query("SELECT CAST(SUM(j) AS BIGINT) AS s FROM d_" + id);
                            }
                        }
                    } catch (Throwable e) {
                        errors.add(e);
                    }
                    return null;
                });
            }
            for (var f : pool.invokeAll(tasks)) f.get();
            pool.shutdown();
            assertTrue(errors.isEmpty(), "concurrent SQL raised: " + errors);
        }
    }
}