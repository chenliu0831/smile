# S8 — Close the Loop (Ask Clair about a column + one-click Next Steps)

> ready-for-agent · PRD: ../PRD-explorable-automl-cockpit.md · ADR-0006

## What to build

Turn passive readouts into active steering, reusing the existing agentic seams (`sendMessage` / `askClair` / `awaitingAgentSql` / the `user-message` channel) — almost entirely frontend.

End-to-end, two affordances:
1. **Ask Clair about this column** — on each **SQL Console** schema-rail column, an affordance that pre-seeds a prompt with the column's name and dtype (and, when present, its driver rank from the diagnostics data). Clair answers in chat and proposes a confirming SQL *into the editor* — insert-then-Run, never auto-run (don't contend for the single DuckDB connection).
2. **One-click Next Steps** — parse the report's own "Recommended Next Steps" into context-rich buttons (e.g. "Add CatBoost as a 4th learner", "Switch Platt → isotonic", "Tune threshold for F1"), each sending a templated steering turn carrying the current solution + baseline metric as a new turn.

One backend line: give the report artifact the same mtime-keyed re-emit the image path already has, so a regenerated report refreshes the canvas.

Scope note: "Ask Clair" is scoped to the schema rail that exists; flat-PNG charts cannot carry per-bar click targets, so "ask about this histogram bar" is out of scope here.

## Acceptance criteria

- [x] Each schema-rail column has an "Ask Clair about &lt;column&gt;" affordance that pre-seeds name + dtype (+ driver rank when available) and sends a `user-message` turn.
- [x] Clair's proposed SQL is inserted into the editor (insert-then-Run), not auto-executed.
- [x] The report's "Recommended Next Steps" render as buttons that each send a templated steering turn carrying the current solution + baseline metric.
- [x] A regenerated report re-emits and refreshes the canvas (watcher mtime re-emit for the report artifact).
- [x] A replay-fixture UAT asserts the column affordance fires a `user-message` and a Next-Steps button sends its templated turn.

## Blocked by

- None — can start immediately. (Driver-rank context in the column prompt is a soft enhancement that benefits from S4 — Driver Diagnostics — but is not required.)

**Status: complete.** Schema-rail per-column 'Ask Clair' (name+dtype, +driver rank from S4 diagnostics when present) via askClair insert-then-Run; report 'Recommended Next Steps' → one-click steering buttons carrying the Scorecard baseline; watcher report mtime re-emit (stable ref, seeded to avoid first-emit dupe). Verified: app 145 tests + tsc clean; serve watcher/conformance pass.
