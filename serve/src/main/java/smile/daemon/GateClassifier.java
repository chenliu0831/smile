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
import java.util.Optional;

/**
 * The PURE gate-classification + answer-selection logic for an agent {@code onQuestion}
 * callback (ADR-0010), extracted from {@link AgentRunSource} so it is unit-testable without
 * a live agent, the same way {@link ToolPresenter} is. No I/O, no {@link RunControl} reads —
 * the effectful parts (awaiting the gate, the {@code control.isCancelled()} check, emitting
 * messages, calling {@code Question.complete}) stay in the handler, which feeds this class's
 * decisions the booleans it needs.
 *
 * @author Haifeng Li
 */
final class GateClassifier {
    private GateClassifier() {}

    /**
     * The classification of an agent question into a gate. {@code gateHeader} is the label
     * shown on the gate (and tested for the approval heuristic); note it uses a DIFFERENT
     * default ("Needs your input") than the protocol Question's header default (""), matching
     * the original inline behavior exactly.
     */
    record Decision(String kind, String gateHeader, boolean approval) {}

    /**
     * Classify a question by its header and choices. A choice-less question whose header reads
     * like an approval (e.g. the SDK's tool-call-limit gate, which expects exactly "Yes") is an
     * APPROVAL gate; anything else is a clarify gate the user answers with text/options.
     *
     * @param header  the agent question's header (nullable).
     * @param choices the agent question's choices (nullable/empty for free-text or approval).
     */
    static Decision classify(String header, List<String> choices) {
        String gateHeader = header != null ? header : "Needs your input";
        boolean approval = (choices == null || choices.isEmpty())
                && gateHeader.toLowerCase().contains("approval");
        return new Decision(approval ? "approval" : "clarify", gateHeader, approval);
    }

    /** The header to put on the protocol {@code Question} (empty string when absent). */
    static String questionHeader(String header) {
        return header != null ? header : "";
    }

    /**
     * The string to hand the SDK's {@code Question.complete(...)} given the turn outcome.
     * Pure: the caller supplies whether the turn was aborted (from {@link RunControl}) and the
     * user's answer; this picks the right completion value.
     *
     * <ul>
     *   <li>aborted → "No" for an approval gate (decline), "" otherwise</li>
     *   <li>approval (not aborted) → "Yes" (the webview's Approve sends an empty answer; the
     *       SDK needs "Yes")</li>
     *   <li>clarify → the user's answer if present &amp; non-blank, else the first choice, else
     *       "proceed"</li>
     * </ul>
     */
    static String answerFor(boolean aborted, boolean approval, Optional<String> answer, List<String> choices) {
        if (aborted) return approval ? "No" : "";
        if (approval) return "Yes";
        if (answer.isPresent() && !answer.get().isBlank()) return answer.get();
        if (choices != null && !choices.isEmpty()) return choices.get(0);
        return "proceed";
    }
}
