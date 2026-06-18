# Tiered human-in-the-loop gating, implemented at the host layer

## Context

"Mostly automatic with human in the loop" needs a deliberate stance on *which* moments of Clair's autonomous `automl` pipeline pause for a human. The skill already streams live, **asks once** at ambiguous decisions (task type, metric, budget) via `onQuestion`, and has a separate read-only **plan mode** agent — but once started it otherwise runs its full ~2-hour pipeline autonomously, including expensive (NAS, CAAFE) and consequential (final model choice) steps.

## Decision

A **tiered Gate model**, tuned so the default feels automatic:

- **Auto (no gate):** EDA, preprocessing, feature engineering, candidate evaluation, refinement cycles — stream live, never block. This is the "mostly automatic."
- **Clarify gate (blocking, already exists):** genuine ambiguities (task type, primary metric, compute budget) surface `onQuestion` inline; the Run cannot proceed without an answer.
- **Approval gate (blocking, opt-in):** before expensive/consequential actions (starting the Run, GPU NAS, writes outside the working dir). **Default = approve-on-start only** (approve once, then autonomy); a settings toggle enables "approve each expensive step" for cautious users.
- **Plan mode (pre-flight, exists):** the read-only plan agent produces an editable plan → user approves → Run starts.

Principle: gate where a wrong autonomous choice is costly or hard to undo; otherwise flow. Consistent with progressive disclosure — cautious users dial gating up, the default is one approval then autonomy.

## Constraint: minimal change to existing skills

Gating is implemented at the **daemon/host layer**, NOT by rewriting the skill `SKILL.md` files. It rides on mechanisms the skills already expose: the existing `onQuestion` Clarify hook, the skill's explicit numbered stages (for approval checkpoints), and the existing plan-mode agent. The autonomous pipeline definitions stay essentially untouched; the host decides where to intercept and when to ask the UI.

## Consequences

- The daemon needs a host-side interception/approval layer keyed off stage transitions and tool-call types — but no edits to the AutoML pipeline logic.
- "Approve each expensive step" requires the host to recognize which stages/tool calls are "expensive" (NAS, CAAFE, out-of-dir writes) — a small host-side classification, not a skill change.
- If future requirements need gates the skills don't expose, *then* a skill change is reconsidered — but that is explicitly avoided in the first design.
