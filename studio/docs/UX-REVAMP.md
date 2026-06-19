# UX Revamp — Fixed Chrome + One Swappable Canvas

Decision doc for the major UX revamp. Backed by an empirical self-review (`UX-SELF-REVIEW.md`,
real app + loaded dataset) and two workflows — a 4-lens UX critique and a 5-angle deep
research — which **independently converged** on the same target IA.

## Root cause (one problem behind the top frictions)

The agent chat — the product — is modeled as the 360px right *zone inside one closeable
dockview tab* ("AutoML Run"), a co-equal peer to Data / Explore / Notebook / Kernel.
So it can be closed/dragged/buried with **no recovery**, and it's structurally demoted
beneath empty, deferred stubs. Fixing the IA resolves 5 of the top 7 findings at once.

## Target IA — three regions, only the middle swaps

1. **Persistent left rail (fixed chrome, never closeable)** — a thin view switcher:
   named buttons for every canvas view (Overview, Data, Explore, Pipeline, Leaderboard).
   This rail is the **recoverability backbone** — controls live *outside* what they
   restore (VS Code activity bar pattern). Plus a "Reset layout" affordance.
2. **Persistent Clair chat (fixed chrome, never closeable)** — `AgentStream` promoted
   out of the dock into a permanent right column. The always-visible spine/audit log.
3. **Swappable canvas (the only dynamic region)** — one work surface that swaps content
   (Data preview, Explore, Pipeline timeline, Leaderboard, charts, reports) chosen from
   the left rail. No top-level tabs to destroy.

**Kill dockview as primary navigation.** The existing `.run` grid (Timeline / Canvas /
Stream) is already ~80% the right shape — lift it to be the app shell; make chat + rail
fixed chrome and let only the canvas content swap.

## What we cut / demote

- **Notebook** — remove from top-level (non-functional stub, P6-deferred). Future
  "view the code Clair ran" becomes an on-demand affordance from a run, not a tab.
- **Kernel Explorer** — remove from top-level (empty stub). Its real future content
  (models/services) folds into a canvas view once it has content.
- **dockview dependency** — drop from the shell (kept available if power-user artifact
  splitting is ever needed; not used for primary nav).

## What we keep + elevate

- **Clair chat** → permanent chrome (the core).
- **Timeline** → the live pipeline view (a canvas view + a compact in-chat indicator).
- **Canvas / Leaderboard / Chart / DataGrid / DataExplorer** → swappable canvas views.
- **Topbar** (dataset chip, Load/Change, Settings) → global chrome + new **Reset layout**.
- **Layout persistence** → keep, but it can never strand the user (chat is chrome).

## Cold-start (no blank canvas)

Chat-first on launch (canvas hidden until the first artifact). The pre-dataset empty
state in the chat shows: a "Load a dataset" CTA, a **"Try a sample dataset"** path, and
2–4 starter-prompt chips ("Summarize this dataset", "What can you predict?", "Build the
best model"). Once a dataset is loaded, the chat shows it's in scope and suggests a first
analysis. The canvas reveals (splits in) when the first view/artifact exists.

## Status-pill fix

"Running" currently shows on mere daemon connection. Relabel: **Ready/Connected** when
idle-but-connected; **Working** only while `streaming` or stages are active.

## Build plan

A focused frontend rewrite of `Shell.tsx` into a fixed-chrome shell (`Workspace.tsx`),
a left **ViewRail**, a swappable **Canvas host**, persistent chat, cold-start empty
state with sample-data + starter chips, and a Reset-layout/non-destructible guarantee.
No daemon/protocol changes required. Verify end-to-end with the loaded churn dataset.
