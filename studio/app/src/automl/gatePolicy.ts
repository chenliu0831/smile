/**
 * The host-layer gating policy (ADR-0010). Decides whether a proposed agent action
 * pauses for a human, and at which tier. Implemented host-side so the autonomous
 * `automl` skill is left untouched — "mostly automatic with human in the loop".
 */
import type { GateKind } from "../daemon/protocol";

export type ActionKind =
  /** EDA, preprocessing, feature engineering, candidate eval, refinement — never gated. */
  | "routine"
  /** A genuine ambiguity the skill asks about (task type, metric, budget). */
  | "clarify"
  /** Starting the whole Run. */
  | "start-run"
  /** Expensive/consequential: GPU NAS, CAAFE, writes outside the working dir. */
  | "expensive";

export interface ProposedAction {
  kind: ActionKind;
  label: string;
  /** For clarify actions, the question the skill posed. */
  question?: { id: string; prompt: string; options?: string[] };
}

export type ApprovalMode = "on-start" | "per-step";

export interface GatePolicy {
  approvalMode: ApprovalMode;
}

export interface GateDecision {
  kind: GateKind;
  prompt: string;
}

/** Returns the gate to raise for an action, or null if it should proceed unblocked. */
export function gateFor(action: ProposedAction, policy: GatePolicy): GateDecision | null {
  switch (action.kind) {
    case "routine":
      return null;
    case "clarify":
      return { kind: "clarify", prompt: action.question?.prompt ?? action.label };
    case "start-run":
      return { kind: "approval", prompt: action.label };
    case "expensive":
      // Approve-on-start (default) lets expensive mid-run steps flow once the run is
      // approved; per-step opt-in re-gates each one for cautious users.
      return policy.approvalMode === "per-step"
        ? { kind: "approval", prompt: action.label }
        : null;
  }
}
