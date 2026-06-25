# Auto-follow pipeline navigation

## Status

accepted

## Context

As an AutoML Run streams, its stages complete and emit artifacts, but the cockpit did not
follow along. The existing auto-reveal (`Workspace.tsx`) switches the canvas *view*
(overview / pipeline / leaderboard) as the workflow progresses, latched by `userPicked` so it
never yanks a user off a view they chose — but it never selects a specific *stage*
(`selectedStage` stayed `null`, showing all artifacts), and it jumps to the **leaderboard**
view the instant a leaderboard artifact exists, which would shadow any stage-following.
We wanted the cockpit to "navigate to the right pipeline step when its artifacts show up."

## Decision

As a Run streams, **auto-follow drives the Pipeline view and selects the latest stage that
has at least one resolvable artifact** — superseding the leaderboard auto-jump. When the Run
finishes, it rests on the final report stage. The follow honors the existing "don't yank the
reader" discipline: **any manual stage or view click stops auto-following for the rest of the
run**, re-arming when a *new run* starts (a transition into the `running` status) — not on a
mid-run chat reply, which leaves the user's selection intact.

Three sub-decisions:

1. **Follow trigger = a stage with resolvable artifacts, not merely `running`.** The watcher
   seeds the whole timeline as `pending` up front and a stage can go `running` before it has
   produced anything. Keying on "the stage's `artifactRefs` resolve to ≥1 artifact in the
   store" matches the literal ask ("when the right artifacts show up") and avoids selecting an
   empty stage.

2. **Stage-following owns the view whenever there's a followable stage, superseding the
   leaderboard jump.** One coherent "watch it work" narrative beats interleaving a one-time
   leaderboard jump mid-run — and it must hold at finish too, so the "rest on the final
   report" decision is actually shown rather than being immediately overwritten by the
   leaderboard auto-reveal (a self-contradiction the first cut shipped). So `autoTarget`
   prefers Pipeline whenever `selectAutoFollow` returns a stage (live OR rested-on-report);
   the leaderboard auto-reveal applies only when there's no followable stage at all (e.g. a
   summarize-only turn that produced a board but no pipeline). The Leaderboard remains one
   rail click away.

3. **Re-arm on new-run intent, not on every user turn.** The latch re-arms on a transition
   *into* the `running` status. `status` flips to `running` only on session/run-started and
   never on `turn-finished`, so a mid-run chat reply ("why did you skip resampling?") keeps
   `status === "running"` and does **not** re-arm — auto-follow won't yank a reader off a
   stage just because they asked a question. A genuinely new run does re-arm.

4. **Default-on, with a manual escape hatch.** Per the UX tenet (automated-first), the
   cockpit follows the run by default; the power user who clicks a stage/view to read takes
   control and is never pulled away again that run. State stays component-local (`useState`
   in `Workspace`), consistent with how `selectedStage`/`userPicked`/`view` already live — no
   store/protocol change.

   The two auto-nav effects (view reveal + stage select) gate on `userPicked` AND keep it in
   their dependency arrays, and do **not** advance their "last target" memo while latched —
   so the moment the latch clears on re-arm they re-fire and write the still-pending target,
   even when it equals the prior run's (the stale-closure trap the first cut fell into).

## Consequences

- `selectedStage` is lifted from `CanvasRegion` up to `WorkspaceInner` so the auto-follow
  effect (which already owns `view`/`userPicked`) can set both the view and the selected stage
  coherently, and a single `userPicked` latch governs both.
- The behavior is invisible-but-correct for a summarize-only turn (no stages): auto-reveal
  falls back to its prior overview/data targets.
- Tested via UATs with hand-built `StageProgress` carrying populated `artifactRefs` (the
  captured fixtures leave `artifactRefs` empty): follow-as-artifacts-land, rest-on-the-final-
  report (asserting Pipeline owns the view, not Leaderboard), manual-click latch holds against
  a later stage, a mid-run chat reply preserves the manual selection, and a new run re-arms.
  The "which stage" decision itself is a pure `selectAutoFollow` selector with its own
  exhaustive unit tests.
