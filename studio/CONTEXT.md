# Smile Studio

The agentic ML/data-science workspace built on the Smile (Statistical Machine Intelligence) JVM library. This context covers the reimagined Tauri-based frontend and the headless JVM backend it drives.

## Language

### Application shell

**Smile Daemon**:
The single headless JVM process that hosts all backend capability — kernels, agents, AutoML training, and model serving — and exposes it over local network APIs. The evolution of the existing Quarkus `serve/` module.
_Avoid_: backend, server, sidecar (the daemon *is run as* Tauri's sidecar, but the noun "sidecar" refers to the OS-process role, not this component)

**Shell**:
The Tauri Rust Core process. Owns the OS, supervises the **Smile Daemon** as a spawned sidecar, owns global state, and mediates all IPC between the **Webview** and the daemon.
_Avoid_: Rust backend, host

**Webview**:
The system-webview UI process. Renders all user-facing surfaces. Has no direct OS or daemon access — everything routes through the **Shell**.
_Avoid_: frontend (acceptable loosely, but "Webview" is the precise process)

**Agent Surface**:
The single, context-routing conversational + AutoML Run surface that is the app's home. Replaces the legacy three persona tabs (Clair/James/Guido) — the agent routes by task context (analysis / Java / Python) rather than the user picking a persona.
_Avoid_: chat panel, Clair tab, persona tabs

**Notebook** (escape hatch):
The multi-cell code surface (Java/JShell, Python kernels), a *peer* surface to the **Agent Surface** sharing the same kernel and working directory. Agent-generated cells land here as durable, editable artifacts with accept/reject diffs. The power-user escape hatch, not the home.
_Avoid_: making it the default/home surface

### AutoML

**AutoML Run**:
One execution of Clair's `automl` agent skill over a dataset — the full autonomous pipeline (EDA → preprocess → leakage check → feature engineering → candidate research → evaluation → iterative refinement → ensemble → postprocess → final evaluation → report). The top-level unit of AutoML work. It is **agent-orchestrated and Python-based** (runs in the kernel), not a JVM algorithm sweep.
_Avoid_: experiment, job, autopilot-as-a-backend-service (the orchestration lives in the agent skill, not a separate daemon orchestrator)

**Candidate**:
One model approach the AutoML Run implements, runs, and scores during candidate evaluation (e.g. a LightGBM baseline). Recorded as a row in `candidate_scores.md`. The **Leaderboard** UI renders these rows.
_Avoid_: trial, model (a Candidate is the scored attempt)

**Leaderboard**:
The UI view that renders the AutoML Run's `candidate_scores.md` and `refinement_log.md` as a ranked, sortable table — companion metrics as columns, scoring regime (CV vs holdout) shown per score. A *projection of agent-produced artifacts*, not a backend-owned table.
_Avoid_: results table, scoreboard

**Run Artifacts**:
The durable files an AutoML Run produces in the working directory: `eda_report.md`, `candidate_scores.md`, `refinement_log.md`, `solution_final.py`, `submission.csv`, `automl_report.md` (8 sections), and `DataViz` charts (ROC, confusion-matrix heatmap, correlation heatmap, SHAP/feature importance). The frontend surfaces these as first-class objects.
_Avoid_: outputs, results

### Cockpit views

**Cockpit**:
The explorable evolution of the **AutoML Run** view — the **Run Artifacts** rendered as interactive, drillable surfaces (a metric strip, a sortable board, prediction diagnostics) rather than a flat report. Not a new screen: the existing canvas + rail, enriched.
_Avoid_: dashboard, report viewer

**Predictions Studio**:
The signature interactive surface — a compound view over the per-row prediction set (`*_proba`/`*_pred`/`*_actual`) with a live threshold slider driving a confusion matrix and ROC curve, all recomputed client-side. A bespoke component in a **Canvas** branch, gated on the prediction schema (no-ops for regression/unlabeled runs).
_Avoid_: results page, ROC chart (it is the whole compound view)

**Scorecard**:
The persistent metric strip above the canvas, sourced from the `metrics` **Artifact** (`final_metrics.json`). Carries the `task_type` that lets the rest of the UI self-configure (killing the hard-coded `"binary"` leaderboard metric).
_Avoid_: header, stats bar

**Driver Diagnostics**:
The permutation-importance view — a horizontal bar chart with ±1 std whiskers over the small importance array carried inline in the `diagnostics` **Artifact**. Each bar is an EDA entry point ("Ask Clair about this feature").
_Avoid_: feature importance chart (this includes the uncertainty + steering affordances)

**meta** (structured artifact payload):
The single typed JSON field on an **Artifact** that carries structured payloads (`metrics`, `diagnostics`). Distinct from `body` (now markdown / `data:` URIs only) and `data` (an **Arrow Frame** reference for bulk tabular). The one schema-describable channel for structured data.
_Avoid_: stuffing JSON into `body`, payload, blob

### Model production paths

**Trained Model** (JVM path):
A serialized Smile model (`.sml`) produced by `smile train` or by saving a kernel variable, tracked under the Kernel Explorer's **Models** node, deployable via the Quarkus **serve** inference service.
_Avoid_: conflating with the Python `solution_final.py` an **AutoML Run** produces — they are distinct artifacts on distinct paths.

**Solution Pipeline** (agentic path):
The `solution_final.py` an **AutoML Run** produces — a runnable Python pipeline with a fixed seed, not a `.sml` model. **Advisory, not deployable**: it conveys the winning approach and insights; productionizing means reproducing it as a JVM **Trained Model**. Distinct from a **Trained Model**.
_Avoid_: model, .sml, deployable artifact

### Data & transport

**Arrow Frame**:
A chunk of columnar data in Apache Arrow IPC format — the standard wire form for any tabular data (DataFrame pages, prediction result sets) crossing the daemon→Webview boundary. Fed directly into the data grid without JSON conversion.
_Avoid_: result set, table dump, payload

**DataViz call**:
A structured charting tool call the agent emits (`DataViz bar | line | scatter | boxplot | heatmap`) — a chart *spec* (type + encodings + data reference), not a rendered image. The **Webview** renders it natively as a live, themed, interactive chart.
_Avoid_: plot PNG, image, matplotlib output

**Data Grid**:
The virtualized table component that renders all tabular data (DataFrame previews, Leaderboard rows, prediction result sets) by streaming **Arrow Frames** in. Backed by Perspective (FINOS).
_Avoid_: table widget, spreadsheet

**Channel** (Shell-relayed):
A Tauri Channel — the ordered, high-throughput primitive used whenever the **Shell** relays daemon output to the **Webview**. Never the Tauri Event system, which is unsuitable for streaming.
_Avoid_: event, emit

### UX principles

**Progressive disclosure** (the governing UX principle):
The agentic surface is simple enough that a user never *has* to dive deep — the default view of an **AutoML Run** is calm and high-level — but every layer (stage details, tool-call code+output, raw artifacts, the agent's reasoning) is one click away for those who want it. Depth is available, never imposed.
_Avoid_: power-user-first, expose-everything, wizard-only

**Gate**:
A point where an **AutoML Run** pauses for a human. Three tiers: **Clarify gate** (ask-once ambiguities — task type, metric, budget — via the existing `onQuestion`), **Approval gate** (before expensive/consequential actions; default is approve-on-start only, per-step is opt-in), and **Plan mode** (pre-flight editable plan before the Run starts). Routine stages are ungated and stream freely.
_Avoid_: confirmation, prompt (reserve "Gate" for these blocking human-in-the-loop points)

**Run Progress**:
The abstract, daemon-emitted progress stream for an **AutoML Run** — `{stageId, label, status, artifactRefs}` per stage — that drives the pipeline timeline. Sourced by the daemon from the skill's checkpoint + tool-call events; the **Webview** never parses the skill's private `state.json` directly.
_Avoid_: state.json (that is the skill's private checkpoint, not the UI contract)

## Relationships

- The **Shell** spawns and supervises exactly one **Smile Daemon** sidecar, and mints the session token the **Webview** uses to reach it.
- Control/lifecycle/OS actions: **Webview** → **Shell** (`invoke`) → **Smile Daemon**.
- High-throughput streams and **Arrow Frame** data: **Webview** ↔ **Smile Daemon** directly (loopback, token-authenticated).
- The **Smile Daemon** hosts kernels, agents, AutoML training, and serving in one JVM.
- An **AutoML Run** produces **Run Artifacts** and a **Solution Pipeline**; the **Leaderboard** and **DataViz calls** are views over those artifacts.
- A **Solution Pipeline** is advisory; only a **Trained Model** (`.sml`) is deployable via **serve** (deployment deferred).
- A **Gate** pauses an **AutoML Run**; **Run Progress** drives the timeline that shows where it paused.

## Example dialogue

> **Designer:** "When Clair finishes an **AutoML Run**, can the user click *Deploy* on the **Leaderboard** winner?"
> **Domain expert:** "Not directly — the winner is a **Solution Pipeline**, a Python file. It's advisory. To deploy you reproduce it as a Smile **Trained Model**, and that's deferred scope anyway."
> **Designer:** "And the charts in the **Run Artifacts** — are those images we display?"
> **Domain expert:** "No. The agent emits **DataViz calls** — chart specs. The **Webview** renders them natively, and the data behind them comes over as an **Arrow Frame** into the **Data Grid** or chart."

## Flagged ambiguities

- "sidecar" / "daemon" / "server" were used interchangeably — resolved: the component is the **Smile Daemon**; "sidecar" denotes only its OS-process role under the **Shell**.
- "AutoML" was assumed to mean a `smile train` algorithm sweep — resolved: it is Clair's existing **`automl` agent skill** (Python, agent-orchestrated); the frontend surfaces it, does not orchestrate it.
- "model" was used for both a `.sml` **Trained Model** and a Run's `solution_final.py` — resolved: these are distinct (**Trained Model** vs **Solution Pipeline**) on distinct production paths.
