# Tauri Shell over a single JVM daemon

The reimagined Smile Studio frontend is a Tauri app: a Rust **Shell** (Core process) renders a system **Webview** and spawns one headless **Smile Daemon** sidecar that hosts all backend capability — the Java/Scala/Python kernels, the `ioa-agent` agents (Clair/James/Guido), the `smile train/predict/serve` AutoML engine, and model serving — in a single JVM. The Webview never touches the OS or the daemon directly; the Shell mediates all IPC.

## Considered Options

- **Single evolved `serve/` Quarkus daemon (chosen).** The existing `serve/` module already provides HTTP, streaming inference (`Multi<String>`), `/models` metadata, an OpenAI-compatible chat API, and DI. We extend it to also host kernels and agents, reusing all `smile.studio.*` logic. One process for the Shell to supervise.
- Brand-new daemon module. Clean slate but re-implements streaming/serving plumbing that already works.
- Two sidecars (serving server + studio/kernel/agent server). More lifecycle and port management for the Shell, no clear benefit since they share the JVM classpath and model objects.
- Electron instead of Tauri. Rejected by the locked framework decision; Tauri's Rust Core gives a stronger trust boundary and smaller footprint.

## Consequences

- The `serve/` module grows from an inference server into the full backend; its boundary widens and it gains a dependency on the kernel/agent code.
- The Shell must manage daemon lifecycle (spawn, health, restart, shutdown) and is the only place OS/daemon access is granted — a deliberate single chokepoint for security and IPC interception.
- A bundled JRE must be packaged so the daemon runs without a system Java (addressed separately).
