# Agentic Refinement — Top 3 Proposals

Phase goal (user): refine the agentic experience by leveraging what the **current `ioa`
agent already supports** — no new agent/LLM capability, no dependency on the deferred
P6 notebook/kernel project. Grounded in the `ioa-agent-capability-research` workflow
(16 agents: 5 capability readers over the jar/specs/our code → ideate → adversarial
verify → synthesize). Every proposal below was verified on three axes: the ioa
capability genuinely exists, our frontend does **not** already ship it, and it is
P6-independent.

## The core finding

The `ioa` agent exposes a rich interactive surface; our frontend uses a thin slice.
`AgentRunSource` builds the agent once, registers `Tool.file/shell/data/planning`, and
calls only `agent.stream(...)`. It maps `onNext`/`onToolCallStatus`/`onQuestion`/
`onComplete`/`onException` — but **flattens or discards structured payloads**: every
tool call becomes a generic `kind="script"` card with `code=null`; `Question.header`
and `multiSelect` are dropped; `TodoWrite`'s task list is thrown away; `outputTokens`
is never rendered. The biggest wins are recovering structure we already receive.

---

## #1 — Live Todo Checklist (TodoWrite mirror)  ·  effort: medium

**What & why.** The analyst agent already calls `TodoWrite` to maintain a Claude-Code-
style task list (`Tool.planning()` is registered), but each call collapses into a
generic "TodoWrite" card and the structured list is discarded. Detect `TodoWrite` in
`onToolCallStatus`, read its `.todos`, and render a **persistent, live-updating
checklist** (pending / in-progress / completed) with the `activeForm` gerund driving a
"now doing X" line. Highest transparency-per-effort: turns a wall of spinners into a
legible plan the user watches tick off.

**Leverages.** `ioa.llm.tool.TodoWrite` → `List<Todo>` where `Todo{content, status,
activeForm}` (confirmed via javap); delivered through `onToolCallStatus(tool, result)` —
read the live `tool instanceof TodoWrite`.

**UX.** A checklist pinned to the **top of the agent stream zone** (above the
transcript), so the plan stays visible while the conversation scrolls. Filled check =
done, animated dot + gerund = in-progress, hollow = pending. Read-only in v1.

**Work.** Daemon: new `TodoList` message (the existing `ToolCall` record can't carry the
list); branch on `instanceof TodoWrite` and emit it; suppress the duplicate generic
card. Frontend: add to protocol + reducer (`todos` on RunState, replace-by-snapshot),
new `TodoChecklist.tsx`, CSS.

**Risk.** Net-new message type both sides (the only real cost). Replace-by-snapshot
since each `TodoWrite` re-sends the full list.

---

## #2 — Real tool-kind cards with input/code preview  ·  effort: medium

**What & why.** Every tool call is hardcoded `kind="script"`, `code=null`
(`AgentRunSource.java:146`) — discarding the protocol's existing kind union
(`skill|script|shell|read|write|dataviz`) and every tool's input. The frontend
`ToolCallCard` **already renders** `call.kind` (the badge) and `call.code` (the `<pre>`)
— it just never receives real values. Map `tool.getClass()` → the right kind and read
each tool's public input fields into `code`. Best effort-to-value: a single-method Java
change, zero new protocol or frontend rendering, and it shares the `onToolCallStatus`
method with #1.

**Leverages.** `onToolCallStatus(ioa.llm.tool.Tool, Tool$Result)` (already overridden);
read `Bash.command`, `SQL.statement`, `DataViz.{plot,x,y,title}`, `Read.file_path`,
`Write.{file_path,content}`, `Edit.file_path`, `Skill.{command,args}`, `Grep.pattern`,
`Dataset.command`; map class → `ToolCall.kind`.

**UX.** No layout change — existing cards gain a meaningful kind badge (shell/read/
write/dataviz/skill) and show the real command/path/spec on expand. Scannable at a
glance; optional per-kind icons via CSS.

**Work.** Daemon: rewrite the body of `onToolCallStatus` (pattern-match the concrete
tool class → kind + extract input into `code`). Frontend: none required; optional icon
CSS.

**Risk.** `onToolCallStatus` fires only **after** `call()` returns (result always
non-null) — cards stay post-hoc, not live-pre-execution. Enumerate the tool classes and
guard null fields. Low risk; mostly a mapping table.

---

## #3 — Structured multi-choice question gates  ·  effort: medium

**What & why.** `ioa.llm.tool.Question` carries `header`, `choices`, and a `multiSelect`
flag (and the SDK appends an implicit "Other"), but the daemon flattens it to
`{id, prompt, options}` — dropping `header` and `multiSelect` — and the gate UI is
single-select only. Forward `header`/`multiSelect` and render **quick-reply chips**
(single) or a **checkbox set + Submit** (multi). Turns free-text guessing into one-tap
structured answers that map to the skill's form field. Rounds out the theme: #1+#2 cover
tool calls, this covers the human-in-the-loop gate, which already works end-to-end.

**Leverages.** `Question.{header, question, choices, multiSelect}` via
`onQuestion(Question)` (already received; header read then discarded, multiSelect never
referenced). `Question.complete(...)` already resolves the gate.

**UX.** Same inline `GateCard` location. The hardcoded "Needs your input" becomes the
real `header`. Multi-select renders checkboxes + Submit that aggregates picks into one
answer; the implicit "Other" reveals a free-text box.

**Work.** Daemon: add `header`/`multiSelect` to the `Question` record and forward them.
Frontend: add them to protocol's `Question`, render `header`, add a multi-select branch.

**Risk.** Narrow adoption — only the `init` skill declares `AskUserQuestion` today, so
the multi-select path may rarely trigger. The header-forwarding half delivers value
regardless. Mechanism and under-rendering are both real.

---

## Also considered (strong follow-ups, not top-3)

- **Reasoning-effort selector** (rank 4) — lowest effort, capability fully confirmed
  (`LLM.reasoningEffortLevels()` + `REASONING_EFFORT`; daemon already writes
  `params()` per turn), reference Swing impl to copy. Dropped only because it's a
  latency knob, not the transparency/legibility this brief prioritizes.
- **Memory panel (view/edit `.smile/SMILE.md`)** — high value, capability-real
  (`Agent.addMemory`, `Context.addInstructions`+`refresh`). Held out as the largest
  medium-effort item (new daemon endpoints + always-visible panel + inline editor +
  "Remember this" action).

## Rejected (with reason)

- **Slash-command palette for skills** — headline value is NOT frontend-only: the daemon
  doesn't register the `Skill` tool nor call `Conversation.invokeSkill`, so `/init`
  would still hit the LLM phrase-match path. True deterministic routing needs net-new
  daemon work; proposal overstated what ships.
- **Conversation persistence/resume** — capability real (`Conversation.withId/id/
  messages()`) but explicitly high-effort/high-blast-radius (session lifecycle, mid-
  stream reconnect, reconciling SDK messages vs the reducer's turn model). Deserves its
  own effort.
- **Pre-execution "running" tool spinner** — not achievable with this SDK
  (`onToolCallStatus` fires only after `call()` returns).

---

## Recommended sequencing

Ship **#2 first** (cheapest, no new protocol, immediate legibility), then **#1**
(shares the `onToolCallStatus` hook; highest transparency payoff), then **#3**. All
three land in the same two files daemon-side (`AgentRunSource.onToolCallStatus` /
`onQuestion`) and the agent-stream UI — a cohesive, low-risk refinement pass.
