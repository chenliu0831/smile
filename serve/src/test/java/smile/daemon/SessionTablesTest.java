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

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Unit tests for the pure logic the {@link SessionTables} gateway centralizes — the
 * safe-identifier grammar that was previously hand-written in five files. The
 * session-backed methods (list/columns/exists) need a live DuckDB session and are covered by
 * the resource-level tests; here we pin the grammar and the degrade-quietly contract.
 *
 * @author Haifeng Li
 */
public class SessionTablesTest {

    @Test
    public void acceptsPlainIdentifiers() {
        assertTrue(SessionTables.isValidIdentifier("titanic"));
        assertTrue(SessionTables.isValidIdentifier("customers_2"));
        assertTrue(SessionTables.isValidIdentifier("_tmp"));
        assertTrue(SessionTables.isValidIdentifier("T123"));
    }

    @Test
    public void rejectsInjectionAndMalformedNames() {
        assertFalse(SessionTables.isValidIdentifier(null));
        assertFalse(SessionTables.isValidIdentifier(""));
        assertFalse(SessionTables.isValidIdentifier("2cool"));        // leading digit
        assertFalse(SessionTables.isValidIdentifier("drop table x")); // spaces
        assertFalse(SessionTables.isValidIdentifier("a\";DROP"));     // quote/semicolon
        assertFalse(SessionTables.isValidIdentifier("schema.table")); // dot
    }

    @Test
    public void existsQuietlyShortCircuitsInvalidNamesWithoutTouchingTheEngine() {
        // A non-identifier is never a session table and must not reach the (absent) bridge.
        assertFalse(SessionTables.existsQuietly("not a name; DROP"));
        assertFalse(SessionTables.existsQuietly(null));
    }

    @Test
    public void existsQuietlyDegradesToFalseWhenNoSession() {
        // No live ioa SQL singleton in a plain unit test → the bridge throws → quiet false,
        // never propagates (DataResource relies on this to fall through to demo data).
        assertFalse(SessionTables.existsQuietly("titanic"));
    }
}
