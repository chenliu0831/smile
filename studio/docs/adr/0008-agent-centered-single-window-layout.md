# Agent-centered single-window layout

## Context

Today's Studio is a four-pane Swing app: Project/Kernel Explorer (left), Notebook (center), three persona agent tabs — Clair/James/Guido (right). The locked scope is "reimagine, agentic-first, notebook as escape hatch." Research on ML-IDE layout was an unverified open gap, so this is design judgment, not a cited default.

## Decision

Invert the hierarchy into a single-window, **agent-centered** layout:

- **Home is the Agent Surface + AutoML Run view** (ADR-0006), not a notebook. The user opens the app and talks to the agent or points at data.
- **Notebook is a peer escape hatch**, sharing the same kernel and working directory. Agent-generated cells land here as durable, editable artifacts with cell-level accept/reject diffs (Hex pattern).
- **Kernel Explorer survives and gains importance** — it is the bridge between the two model-production paths (Models/Services → `.sml` → serve, per ADR-0005/future ADR-0009).
- **Project Explorer survives** as a file rail; Run Artifacts get a higher-status home than plain files.
- **The three persona tabs collapse into ONE context-routing Agent Surface.** Agentic-first means the agent routes by task (analysis / Java / Python), not the user choosing a persona tab.
- Panes use a **docking/split framework** (dockview-style), rearrangeable and persisted across sessions.

## Deliberate deletions from legacy parity

Consistent with "reimagine, not parity": the persona tab-strip is removed; the Scala kernel and the standalone Notepad are deprioritized as first-class citizens. These are explicit non-goals, recorded so they are not "restored" later by reflex.

## Consequences

- Significant IA departure from the Swing app; existing users must relearn the home surface. Accepted given the reimagine mandate.
- The single Agent Surface needs a context-routing mechanism (which underlying agent/skill handles a turn) — a new concern the daemon must support.
- Pane layout persistence becomes Shell/Webview state (akin to the legacy `.smile/studio.properties` open-file restore).
