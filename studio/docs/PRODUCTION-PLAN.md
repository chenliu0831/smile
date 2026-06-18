# Smile Studio — Production Agentic AutoML: Implementation Plan

Goal (user): a real production app — dataset loading, agent-driven data insights, an
**interactive conversational prompting** experience like major agentic coding tools
(Cursor/Claude Code), a Sigma-like data-analysis workflow, and a JupyterLab-grade
notebook. Grounded in the `studio-prod-understand` workflow (6 readers + synthesis).

## Current state (verified)

One pre-configured AutoML run per WS connection, no interactivity. `RunSocket.onOpen`
auto-starts from `smile.daemon.prompt`; `wsClient.start()` is a no-op; `AgentRunSource`
builds the Agent, calls `agent.stream()` once, blocks on a latch, discards the Agent.
The `ioa-agent` jar (vendored at `serve/lib/`) supports multi-turn: `Agent.stream()`
reusable, `Conversation` persists, `Question.complete(String)` takes free text.
Frontend three-zone Run view, ECharts, Markdown, Settings (keychain), and a real-but-
unrendered Perspective/Arrow `DataGrid` are wired. Holes: no chat input, no free-text
turn (`answerGate` hardcodes `{type:'approve'}`, drops text), no dataset loader,
Notebook/Kernel panels are inert stubs, daemon serves 2 hardcoded JSON tables.

## Key architectural decisions (from synthesis)

- **Multi-turn**: one long-lived Agent+Conversation per WS connection, looping
  stream→idle→await-next-turn. One turn streams at a time (Conversation is shared
  mutable state). Session resume (Conversation.withId/path) is a later layer.
- **Free-text answers**: carry the answer String through `RunControl` →
  `Question.complete(answer)`. Fixes the lossy gate path. Same channel for chat turns.
- **Dataset → agent**: file-picker → Shell copies file into `<workingDir>/input/` →
  (re)start daemon with that workingDir. Skills already read `./input/` (no skill change).
- **DataFrame → grid**: Arrow IPC over `GET /api/v1/data/{ref}`, parsed with
  apache-arrow, fed to Perspective via the existing `toArrowIPC` seam. Drop the JSON stub.
- **Kernels/notebook**: hybrid — agent keeps its in-process data tools; the Notebook
  gets its own JShell/iPython kernel sharing the working dir, via new kernel-* WS messages.
- **Gating**: host-side interceptor (ADR-0010), never editing SKILL.md.

## Phases (dependency-ordered, highest user value first)

- **P0 — Protocol foundation**: `user-message` reply + free-text `answer`; mirror in
  protocol.ts + DaemonMessage.java; `RunConnection.sendMessage`; mint+verify WS session
  token (ADR-0002) since we open an inbound channel.
- **P1 — Interactive chat spine** ⭐: long-lived `ChatSession` (Agent+Conversation built
  once), stream-then-idle-then-await loop; RunSocket waits for first user-message;
  free-text clarify answers; chat-input + stop + per-turn transcript UI.
- **P2 — Dataset loading**: Tauri file dialog → Shell copies into `input/` → restart
  daemon with workingDir before connect. Agent can see the data.
- **P3 — Real Arrow data path + insights grid**: daemon loads dataset via
  `smile.io.Read.data` → schema + describe() + paged slice as Arrow IPC; frontend fetches
  Arrow, renders `DataGrid` in a dataset panel + the missing `dataframe` artifact branch.
- **P4 — Rich Run rendering + gating**: structured StageProgress + artifact-watching;
  host-side tiered gating + stop via ioa interrupt convention.
- **P5 — Sigma-like explorer**: Perspective with pivot/filter/aggregate chrome unlocked
  over the dataset's Arrow frame (builds on P3).
- **P6 — JupyterLab notebook + kernel explorer**: daemon kernel-exec API (JShell + iPython)
  over WS; real Cell model (.ipynb w/ outputs); KernelPanel from live variable introspection;
  model save (.sml). Largest greenfield; the power-user escape hatch.

## Top risks (carry forward)

- Shared mutable Conversation → one turn at a time; block input while streaming.
- jackson-annotations force-pin 2.22 must survive any dep bump (Jackson 3 vs Quarkus BOM).
- WS has no auth today; mint the session token in P0 with the inbound channel.
- Process-global Dataset registry in the jar → single active session per daemon.
- `quarkusDev` classloader can't run agent mode → use the built `quarkus-run.jar`.
- `gpt-oss-120b` file-read flaky on small CSVs (model quirk, not wiring).
