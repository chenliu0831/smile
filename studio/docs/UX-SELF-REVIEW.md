# UX Self-Review (empirical, with a loaded dataset)

Method: ran the real app against the live daemon with a loaded 120-row `churn.csv`,
drove a first-run journey, and probed the tab/close behaviors via CDP. Screenshots in
`/tmp/ux-*.png`. This is the friction catalog feeding the revamp.

## Confirmed friction (empirical)

### BLOCKER — Closing a tab strands the user with no recovery
Every dockview tab has an X. Closing the **AutoML Run** tab removed it and the entire
Clair chat with **no way to get it back**: verified absent — no `+`/add button, no View
menu, no activity bar, no command palette. dockview persists the broken layout to
`localStorage` (`smile.studio.layout.v3`), so the panel stays gone **across reloads**.
This is exactly the user's report. (ux-02: after closing Run, focus fell to the inert
Notebook stub.)

### MAJOR — The core surface (agent chat) is the smallest, dwarfed by empty scaffolding
Landing (ux-01): three columns inside the Run view — an empty **"PIPELINE"** left rail,
a dead-center **"Artifacts will appear here as the run progresses"** column, and Clair's
chat squeezed into a thin middle strip. Meanwhile the **Kernel panel takes ~50% of the
window** showing only "No frames / No models / No services" (all empty). The most
important thing (talking to the agent) is the least prominent; empty future-state
scaffolding dominates.

### MAJOR — Low-value Notebook + Kernel occupy equal top-level tab slots
Notebook is a non-functional stub ("write Python here", "No cells yet"); Kernel is three
empty groups. Both are deferred (P6) yet sit as co-equal tabs to the real product,
competing for attention and space. (User explicitly flagged these as not useful.)

### MAJOR — Cold-start emptiness; dataset-in-scope not surfaced
First run shows empty pipeline + empty kernel + "nothing here yet" everywhere. Even with
a dataset loaded server-side, the landing AutoML view doesn't reflect it — the user must
discover the separate "Data" tab. "Load Dataset" is a small top-right button with no
onboarding pull toward it.

### MINOR — 5-tab dockview IA mismatched to an agent-first product
A closeable-tab dock treats the agent chat as one swappable document among five. For a
chat-centric app the conversation should be persistent chrome, not a closeable tab.

## Implication
These aren't isolated polish items — they point to an IA mismatch (tabs vs agent-first).
The deep-research + multi-lens critique workflows are running to confirm the revamp
direction before implementing. Revamp design → `UX-REVAMP.md`.
