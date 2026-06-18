# The AutoML Run view and progressive disclosure

## Context

Clair's `automl` skill is a long autonomous sequence of tool calls (sub-skill invocations, Python script writes, kernel runs, score parses, refinement cycles). In today's Swing UI this renders as a wall of streaming text. Research (Hex notebook-agent, tool-call-visualization patterns) and the documented "double black-box" AutoML criticism both point to the same fix: make the agent's work **durable, navigable artifacts with visible structure**, not chat scrollback.

## Decision

An **AutoML Run** gets a dedicated, purpose-built view (distinct from the conversational chat panel), built around the **progressive-disclosure** UX principle: *simple by default, deep on demand*. Three coordinated zones:

1. **Pipeline timeline** — the skill's stages (0–11) as steps with live status (running / done / gate-blocked). Driven by an abstract **Run Progress** stream the daemon emits, NOT by the Webview parsing the skill's private `state.json`. Clicking a stage reveals its artifacts and the tool calls it ran.
2. **Live artifact canvas** — renders Run Artifacts as they appear: `eda_report.md`, the **Leaderboard** (`candidate_scores.md` + `refinement_log.md`), charts (ROC, confusion-matrix, correlation heatmap, SHAP/feature importance), and the final `automl_report.md`. Each is a durable, reopenable object.
3. **Agent stream** — token stream plus **collapsible tool-call cards** (collapsed: "Ran candidate_lgbm.py → AUC 0.91"; expanded: code + output). The skill's "ask once" `onQuestion` prompts surface inline as approve/answer gates.

The governing rule: a user who does nothing but watch sees a calm, legible pipeline reaching a result; a user who wants the "why" can open any stage, any tool call, any artifact, down to raw code and the agent's reasoning. **Depth is available, never imposed.**

## Considered Options

- **Timeline from an abstract daemon Run Progress protocol (chosen).** Decouples the UI from the skill's volatile checkpoint format; the daemon adapts `state.json` + tool-call events into stable `{stageId, label, status, artifactRefs}`.
- **Timeline by parsing `state.json` in the Webview.** Rejected: hardens the UI↔skill-contract coupling (already flagged in ADR-0005) at the most volatile layer; `state.json` exists for crash recovery, not display.
- **Reuse the plain chat panel for AutoML.** Rejected: it is the "double black-box" status quo — no structure, no durable artifacts, no progressive disclosure.

## Consequences

- The daemon owns a **Run Progress** adapter — a small, deliberate translation layer that absorbs skill-format churn so the UI stays stable.
- The artifact canvas must render Markdown, tabular data (via the data grid / Arrow), and `DataViz` chart outputs uniformly as first-class objects.
- This view is the product's centerpiece; the conversational chat panel remains for open-ended dialogue but is not where an AutoML Run lives.
