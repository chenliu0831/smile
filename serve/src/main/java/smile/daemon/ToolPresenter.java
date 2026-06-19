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

import ioa.llm.tool.*;

/**
 * Presents an {@code ioa} tool as a legible tool-call card (refinement R2): maps the
 * concrete tool class to the protocol's {@code kind} union (skill | script | shell |
 * read | write | dataviz) and extracts the tool's input field(s) into a {@code code}
 * preview — recovering the structure the daemon previously discarded (every call was
 * hardcoded {@code kind="script"}, {@code code=null}). Pure: no I/O, so it is unit-tested.
 *
 * @author Haifeng Li
 */
final class ToolPresenter {
    private ToolPresenter() {}

    /** The presentable shape of a tool call. */
    record Card(String kind, String title, String code) {}

    /** Map a tool instance to its display kind, a human title, and an input preview. */
    static Card present(Object tool) {
        if (tool instanceof Bash b) {
            return new Card("shell", titleOf("Bash", b.command), b.command);
        }
        if (tool instanceof PowerShell p) {
            return new Card("shell", titleOf("PowerShell", p.command), p.command);
        }
        if (tool instanceof SQL s) {
            String body = s.statement != null ? s.statement : s.command;
            // kind="sql" makes the agent's SQL a first-class, editable card (the user can
            // open it in the SQL console). When the statement creates a table, surface the
            // name in the title so the shared-session table is discoverable.
            String created = createdTableName(body);
            String title = created != null ? "SQL → " + created : titleOf("SQL", body);
            return new Card("sql", title, body);
        }
        if (tool instanceof DataViz d) {
            String code = "plot=" + d.plot + (d.x != null ? ", x=" + d.x : "")
                    + (d.y != null ? ", y=" + d.y : "");
            return new Card("dataviz", "DataViz: " + nullToDash(d.plot), code);
        }
        if (tool instanceof Read r) {
            return new Card("read", "Read " + nullToDash(r.file_path), r.file_path);
        }
        if (tool instanceof Write w) {
            return new Card("write", "Write " + nullToDash(w.file_path), w.content);
        }
        if (tool instanceof Append a) {
            return new Card("write", "Append " + nullToDash(a.file_path), a.content);
        }
        if (tool instanceof Edit e) {
            return new Card("write", "Edit " + nullToDash(e.file_path),
                    e.old_string + "\n→\n" + e.new_string);
        }
        if (tool instanceof ApplyPatch ap) {
            return new Card("write", "Apply patch", ap.patch);
        }
        if (tool instanceof Grep g) {
            return new Card("read", "Grep " + nullToDash(g.pattern), grepCode(g));
        }
        if (tool instanceof Glob gl) {
            return new Card("read", "Glob " + nullToDash(gl.pattern), gl.pattern);
        }
        if (tool instanceof Skill sk) {
            return new Card("skill", "Skill: " + nullToDash(sk.command),
                    sk.args == null || sk.args.isBlank() ? sk.command : sk.command + " " + sk.args);
        }
        if (tool instanceof Task t) {
            return new Card("skill", "Subagent: " + nullToDash(t.subagent_type), t.prompt);
        }
        if (tool instanceof Dataset ds) {
            return new Card("script", "Dataset " + nullToDash(ds.command), datasetCode(ds));
        }
        // Fallback: unknown tool — keep the generic script card with no preview.
        return new Card("script", tool.getClass().getSimpleName(), null);
    }

    /** Pattern: CREATE [OR REPLACE] [TEMP] TABLE|VIEW <name> ... — captures the name. */
    private static final java.util.regex.Pattern CREATE_TABLE = java.util.regex.Pattern.compile(
            "(?is)^\\s*create\\s+(?:or\\s+replace\\s+)?(?:temp(?:orary)?\\s+)?(?:table|view)\\s+"
                    + "(?:if\\s+not\\s+exists\\s+)?\"?([A-Za-z_][A-Za-z0-9_]*)\"?");

    /** The table/view name a CREATE statement defines, or null if it isn't one. */
    private static String createdTableName(String sql) {
        if (sql == null) return null;
        var m = CREATE_TABLE.matcher(sql);
        return m.find() ? m.group(1) : null;
    }

    private static String titleOf(String prefix, String cmd) {
        if (cmd == null || cmd.isBlank()) return prefix;
        String firstLine = cmd.strip().split("\n", 2)[0];
        return firstLine.length() > 80 ? firstLine.substring(0, 80) + "…" : firstLine;
    }

    private static String grepCode(Grep g) {
        StringBuilder sb = new StringBuilder(g.pattern == null ? "" : g.pattern);
        if (g.path != null) sb.append("  in ").append(g.path);
        if (g.glob != null) sb.append("  (").append(g.glob).append(")");
        return sb.toString();
    }

    private static String datasetCode(Dataset d) {
        StringBuilder sb = new StringBuilder(d.command == null ? "" : d.command);
        if (d.name != null) sb.append(" name=").append(d.name);
        if (d.file_path != null) sb.append(" file=").append(d.file_path);
        if (d.column != null) sb.append(" column=").append(d.column);
        return sb.toString();
    }

    private static String nullToDash(String s) {
        return s == null || s.isBlank() ? "—" : s;
    }
}
