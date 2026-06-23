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
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * The typed daemon-to-webview protocol (ADR-0002, ADR-0006). The JSON shapes here
 * mirror {@code studio/app/src/daemon/protocol.ts} exactly; the frontend reducer
 * consumes them unchanged whether they originate from this daemon or the mock.
 *
 * Each message serializes to {@code { "type": "...", ... }} via the {@code type()}
 * discriminator, matching the TypeScript discriminated union.
 *
 * @author Haifeng Li
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public sealed interface DaemonMessage {
    /**
     * The discriminator field shared by every message. Annotated so Jackson emits
     * it as a JSON property — record serialization only includes record components,
     * not interface methods, so without this the wire frame would omit {@code type}.
     */
    @JsonProperty("type")
    String type();

    /** A pipeline stage's status (matches StageStatus in protocol.ts). */
    enum StageStatus { pending, running, blocked, done, skipped, failed }

    /** A pipeline stage in the timeline. */
    record Stage(String stageId, String label, StageStatus status,
                 List<String> artifactRefs, String detail) {}

    /** A tool call rendered as a collapsible card. */
    record ToolCall(String id, String title, String kind, String status,
                    String code, String output, String score) {}

    /** One item in the agent's live task plan (refinement R1). */
    record Todo(String content, String status, String activeForm) {}

    /** A human-in-the-loop question (the Clarify gate). */
    record Question(String id, String header, String prompt, List<String> options, boolean multiSelect) {}

    /** A blocking gate (clarify | approval | plan). */
    record Gate(String id, String kind, String prompt, Question question) {}

    /** A reference to an out-of-band Arrow IPC frame. */
    record ArrowRef(String kind, String ref, Integer rows, Integer cols) {}

    /** A DataViz chart spec (not a rendered image). */
    record DataVizSpec(String type, String title,
                       java.util.Map<String, String> encodings, ArrowRef dataRef) {}

    /**
     * A run artifact (report | leaderboard | chart | dataframe | file | image | metrics | diagnostics).
     * {@code body} carries Markdown or a {@code data:} URI only (ADR-0011); structured JSON payloads
     * ride {@code meta} (a free-form JsonNode), the single typed channel for structured artifact data.
     */
    record Artifact(String ref, String kind, String title, String body,
                    DataVizSpec viz, ArrowRef data, String path, JsonNode meta) {}

    // ---- Concrete messages (one per union member in protocol.ts) ----

    record SessionStarted(String sessionId, String greeting) implements DaemonMessage {
        public String type() { return "session-started"; }
    }

    record TurnStarted(String turnId, String role) implements DaemonMessage {
        public String type() { return "turn-started"; }
    }

    record TurnFinished(String turnId, String status, long outputTokens) implements DaemonMessage {
        public String type() { return "turn-finished"; }
    }

    /** The agent's current task plan (full snapshot; replaces the prior list). */
    record TodoList(String runId, List<Todo> todos) implements DaemonMessage {
        public String type() { return "todo-list"; }
    }

    record RunStarted(String runId, String goal, List<Stage> stages) implements DaemonMessage {
        public String type() { return "run-started"; }
    }

    record StageProgress(String runId, Stage stage) implements DaemonMessage {
        public String type() { return "stage-progress"; }
    }

    record AgentChunk(String runId, String text) implements DaemonMessage {
        public String type() { return "agent-chunk"; }
    }

    record ToolCallMsg(String runId, ToolCall call) implements DaemonMessage {
        public String type() { return "tool-call"; }
    }

    record ArtifactMsg(String runId, Artifact artifact) implements DaemonMessage {
        public String type() { return "artifact"; }
    }

    record GateOpened(String runId, Gate gate) implements DaemonMessage {
        public String type() { return "gate-opened"; }
    }

    record GateClosed(String runId, String gateId) implements DaemonMessage {
        public String type() { return "gate-closed"; }
    }

    record RunFinished(String runId, String status) implements DaemonMessage {
        public String type() { return "run-finished"; }
    }
}
