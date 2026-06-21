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
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Unit tests for the pure gate-classification + answer-selection logic extracted from
 * {@link AgentRunSource} — previously unreachable without a live agent run. Pins the exact
 * behavior the inline code had (approval heuristic, the two header defaults, the
 * abort/approve/clarify completion values).
 *
 * @author Haifeng Li
 */
public class GateClassifierTest {

    @Test
    public void clarifyByDefault() {
        var d = GateClassifier.classify("Primary metric", List.of("AUC", "Accuracy"));
        assertEquals("clarify", d.kind());
        assertEquals("Primary metric", d.gateHeader());
        assertFalse(d.approval());
    }

    @Test
    public void approvalWhenChoicelessAndHeaderSaysApproval() {
        var d = GateClassifier.classify("Approval required", null);
        assertEquals("approval", d.kind());
        assertTrue(d.approval());
    }

    @Test
    public void notApprovalWhenApprovalHeaderButHasChoices() {
        // Choices present → it's a clarify gate the user answers, even if the header mentions approval.
        var d = GateClassifier.classify("Approval", List.of("Yes", "No"));
        assertEquals("clarify", d.kind());
        assertFalse(d.approval());
    }

    @Test
    public void nullHeaderDefaultsToNeedsYourInputForTheGate() {
        // The gate header default is "Needs your input" (distinct from the protocol Question's "").
        var d = GateClassifier.classify(null, null);
        assertEquals("Needs your input", d.gateHeader());
        assertEquals("clarify", d.kind()); // "needs your input" does not contain "approval"
    }

    @Test
    public void questionHeaderDefaultsToEmptyString() {
        assertEquals("", GateClassifier.questionHeader(null));
        assertEquals("Metric", GateClassifier.questionHeader("Metric"));
    }

    @Test
    public void answerForAbortedApprovalIsNo() {
        assertEquals("No", GateClassifier.answerFor(true, true, Optional.empty(), null));
    }

    @Test
    public void answerForAbortedClarifyIsEmpty() {
        assertEquals("", GateClassifier.answerFor(true, false, Optional.of("AUC"), List.of("AUC")));
    }

    @Test
    public void answerForApprovalIsYes() {
        assertEquals("Yes", GateClassifier.answerFor(false, true, Optional.empty(), null));
    }

    @Test
    public void answerForClarifyPrefersUserAnswer() {
        assertEquals("AUC", GateClassifier.answerFor(false, false, Optional.of("AUC"), List.of("F1")));
    }

    @Test
    public void answerForClarifyFallsBackToFirstChoiceThenProceed() {
        assertEquals("F1", GateClassifier.answerFor(false, false, Optional.empty(), List.of("F1", "AUC")));
        assertEquals("F1", GateClassifier.answerFor(false, false, Optional.of("  "), List.of("F1")));
        assertEquals("proceed", GateClassifier.answerFor(false, false, Optional.empty(), List.of()));
        assertEquals("proceed", GateClassifier.answerFor(false, false, Optional.empty(), null));
    }
}
