# Transport: localhost WebSocket + Arrow, with direct Webview↔Daemon streaming

## Decision

The **Smile Daemon** exposes a **localhost HTTP + WebSocket** server (extending Quarkus, bound to 127.0.0.1 on an ephemeral port):

- **REST** for request/response: list/submit/cancel training jobs, fetch the leaderboard, model metadata, deploy actions.
- **WebSocket** for long-lived bidirectional streams: agent token streams, kernel cell output, training progress — multiple concurrent streams at once.
- **Apache Arrow IPC** (over HTTP/WS) for bulk columnar data — DataFrame pages, prediction result sets — fed directly into Perspective in the Webview with no intermediate JSON.

**Stream routing is a hybrid:**

- The **Shell** owns daemon lifecycle. At spawn it mints a per-session auth token and passes `{port, token}` to the **Webview**.
- High-throughput streams flow **Webview ↔ Daemon directly** over authenticated, loopback-bound WebSocket/HTTP.
- Control/lifecycle and OS-touching actions go **through the Shell** as Tauri `invoke` Commands.
- Where the Shell *does* relay daemon output to the Webview, it uses **Tauri Channels, never the Event system** (Tauri docs: the Event system is unsuitable for high-throughput/large payloads; Channels deliver fast, ordered data).

## Considered Options

- **stdin/stdout framing through the spawned child.** Simplest packaging, no port. Rejected: serializes all traffic through one pipe, fights the concurrent agent+kernel+training streams we need, and discards the existing Quarkus HTTP surface.
- **Proxy 100% of traffic through the Rust Shell** (strict Tauri "Core mediates all IPC"). Rejected for bulk/streaming data: adds a copy and latency to multi-MB Arrow frames for no security gain once the channel is token-authenticated and loopback-only. Retained for control/OS actions.

## Consequences

- Deliberate deviation from Tauri's strict IPC-mediation guidance; justified by performance and accepted because the daemon is loopback-bound and token-gated.
- The daemon must authenticate WebSocket/HTTP connections with the Shell-minted token and refuse non-loopback origins.
- Arrow becomes the standard columnar boundary format end-to-end (see CONTEXT.md).
