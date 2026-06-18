# Only JVM models are deployable; AutoML Runs are advisory (deployment deferred)

## Context

The DataRobot north star ends in "one-click deploy to a REST endpoint." Smile already has a serving path: Quarkus `serve` + the Kernel Explorer's Models/Services nodes over `.sml` **Trained Models**. But an **AutoML Run** produces a Python **Solution Pipeline** (`solution_final.py`), not a `.sml` model — so the two paths don't currently meet.

## Decision

**Only JVM `.sml` Trained Models are deployable. The AutoML Run is advisory** — it surfaces the leaderboard, insights, and the winning approach, but does not itself deploy. Productionizing a Run's result means reproducing the chosen approach as a Smile **Trained Model** (via `smile train` / the kernel), which then serves through the existing Quarkus path.

**Deployment UX is deferred scope** — not a near-term deliverable. The first releases focus on the agentic AutoML experience and exploration; the deploy seam comes later.

## Considered Options

- **A — Serve the Python Solution Pipeline directly.** Truly one-click for any Run, but adds a second (Python) serving runtime alongside the JVM stack. Rejected: two serving stacks to operate.
- **B — Only `.sml` models deployable; Runs advisory (chosen).** One serving stack, lean architecture; "deploy from a Run" requires a reproduce-as-Smile step. Accepted, and deferred.
- **C — Both (quick Python serve + productionize to `.sml`).** Most capable but most to build/operate. Rejected for now as over-scoped.

## Consequences

- One serving runtime (JVM/Quarkus) to build, secure, and operate — significantly simpler.
- There is an intentional gap between a Run's Python winner and a deployable Smile model; bridging it (reproduce-as-`.sml`, possibly agent-assisted) is future work, not promised as "one-click."
- The frontend should not advertise one-click deploy from an AutoML Run in early releases; it presents Runs as advisory and routes deployment through the Kernel Explorer's existing Models/Services flow.
