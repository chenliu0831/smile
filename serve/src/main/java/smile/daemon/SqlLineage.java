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

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Remembers the defining SQL of tables/views the SQL console creates (SQL-driven
 * exploration, Phase 2), so the schema rail can show "this table came from that query"
 * without a full DAG/lineage engine. A process-global map keyed by table name — the
 * shared DuckDB session is itself process-global (one per daemon JVM).
 *
 * <p>Only records definitions the daemon observes ({@code Save as table}, or a
 * {@code CREATE TABLE/VIEW ... AS} run through {@code /sql}). Tables the agent creates
 * directly through its own SQL tool won't have a definition here — that's acceptable; the
 * rail just shows no "view definition" for them.
 *
 * @author Haifeng Li
 */
final class SqlLineage {
    private SqlLineage() {}

    /** table name (lower-cased) -> the SELECT that defines it. */
    private static final Map<String, String> DEFINITIONS = new ConcurrentHashMap<>();

    /** CREATE [OR REPLACE] [TEMP] TABLE|VIEW <name> AS <select> — captures name + select. */
    private static final Pattern CREATE_AS = Pattern.compile(
            "(?is)^\\s*create\\s+(?:or\\s+replace\\s+)?(?:temp(?:orary)?\\s+)?(?:table|view)\\s+"
                    + "(?:if\\s+not\\s+exists\\s+)?\"?([A-Za-z_][A-Za-z0-9_]*)\"?\\s+as\\s+(.+)$");

    /** DROP TABLE|VIEW [IF EXISTS] <name> — captures the dropped name. */
    private static final Pattern DROP = Pattern.compile(
            "(?is)^\\s*drop\\s+(?:table|view)\\s+(?:if\\s+exists\\s+)?\"?([A-Za-z_][A-Za-z0-9_]*)\"?");

    /** Records {@code name} as defined by {@code select}. */
    static void record(String name, String select) {
        if (name != null && select != null && !select.isBlank()) {
            DEFINITIONS.put(name.toLowerCase(java.util.Locale.ROOT), select.strip());
        }
    }

    /**
     * If {@code sql} is a CREATE TABLE/VIEW ... AS statement, records its lineage.
     * Returns the created name, or empty if it isn't such a statement.
     */
    static Optional<String> recordIfCreateAs(String sql) {
        if (sql == null) return Optional.empty();
        Matcher m = CREATE_AS.matcher(sql.strip());
        if (m.find()) {
            record(m.group(1), m.group(2));
            return Optional.of(m.group(1));
        }
        return Optional.empty();
    }

    /**
     * If {@code sql} is a DROP TABLE/VIEW statement, forgets that name's lineage so a later
     * recreate (or a name reused for a different shape) doesn't show a stale definition.
     */
    static void forgetIfDrop(String sql) {
        if (sql == null) return;
        Matcher m = DROP.matcher(sql.strip());
        if (m.find()) forget(m.group(1));
    }

    /** The defining SQL of {@code name}, or null if unknown. */
    static String definitionOf(String name) {
        return name == null ? null : DEFINITIONS.get(name.toLowerCase(java.util.Locale.ROOT));
    }

    /** Drops a table's recorded definition (e.g. on DROP). */
    static void forget(String name) {
        if (name != null) DEFINITIONS.remove(name.toLowerCase(java.util.Locale.ROOT));
    }
}
