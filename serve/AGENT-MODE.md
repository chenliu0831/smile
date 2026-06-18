# Smile Daemon — Agent Mode (real Clair / ioa-agent)

The daemon (`serve/`) can drive AutoML Runs two ways, selected by `smile.daemon.engine`:

| `smile.daemon.engine` | Source | Use |
|---|---|---|
| `scripted` (default) | `ScriptedRunSource` | demo / offline / tests; replays a churn run with a real blocking gate |
| `agent` | `AgentRunSource` | the real Clair `automl` agent skill from `ioa-agent` |

### Agent-mode LLM providers (`smile.daemon.llm.provider`)

| provider | how it authenticates |
|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` env var (public Anthropic API) |
| `openai` | `OPENAI_API_KEY` |
| `gemini` | `GOOGLE_API_KEY` |
| `bedrock` | **Claude on Bedrock via the OpenAI-compatible ChatCompletions API**: `smile.daemon.llm.baseUrl` = the Bedrock gateway endpoint, bearer token from `AWS_BEARER_TOKEN_BEDROCK` env var, `smile.daemon.llm.model` = the Bedrock model id |

## Prerequisite: vendored jars (not in git)

The repo's root `.gitignore` excludes `*.jar`, so the agent jars are **not committed**
(same convention as the legacy `studio/lib`). Before building agent mode, copy them in:

```bash
cp /path/to/smile-<ver>/lib/ioa-agent-1.0.0.jar serve/lib/
cp /path/to/smile-<ver>/lib/ioa-aid-1.0.0.jar    serve/lib/
```

`serve/build.gradle.kts` puts `serve/lib/*.jar` on the classpath via `fileTree`.

## What was wired (ADR-0005)

- `serve/lib/ioa-agent-1.0.0.jar` (+ `ioa-aid`) vendored and on the classpath.
- LLM SDKs + agent tool deps added (anthropic/openai/genai/mcp, jsoup, copy_down, serpapi, gson).
- Module deps `base`, `nlp`, `plot` added — the agent needs `smile.io.Paths`, `smile.plot.vega.VegaLite`, etc. at construction time.
- `jackson-annotations` forced to `2.22` — Jackson 3 (`tools.jackson` 3.2.0, used by ioa-agent) calls `findApplyView`, which needs `@JsonApplyView` (added in 2.22); the Quarkus BOM otherwise pins 2.21 → `NoClassDefFoundError`.
- `AgentRunSource` constructs `Agent` via `Agent.Spec.of("analyst")` + `LLM.of(provider, model)`, enables the file/shell/data/planning tool families, and maps the agent stream (`onNext`/`onToolCallStatus`/`onQuestion`/`onComplete`) to `DaemonMessage`s.

## Required runtime configuration

- **`-Dsmile.home=<dir>`** — `Agent.Spec.of` reads `System.getProperty("smile.home")` to look for user rules/skills under `<smile.home>/agents`; without it, `Path.of(null,...)` throws NPE. Any valid dir works (the `agents` subdir is optional).
- **LLM credentials** must be reachable by the daemon JVM:
  - Anthropic: `ANTHROPIC_API_KEY` env var.
  - OpenAI: `OPENAI_API_KEY`.
  - Gemini: `GOOGLE_API_KEY`.
  - (Bedrock-routed Anthropic would require the anthropic SDK's Bedrock config — `CLAUDE_CODE_USE_BEDROCK` alone is NOT consumed by ioa-agent's Anthropic client.)

## Running the production jar (recommended over quarkusDev for agent mode)

`quarkusDev` uses an isolated dev classloader that does NOT expose the `base`/`plot`
module classes to the vendored `ioa-agent` jar, so agent mode fails there with
`NoClassDefFoundError: smile/io/Paths`. Use the built jar (unified classpath):

```bash
./gradlew :serve:quarkusBuild
cd <dataset-dir>   # the agent's working dir = process CWD; must contain input/<data>.csv
AWS_BEARER_TOKEN_BEDROCK='<token>' java \
  --add-opens java.base/java.lang=ALL-UNNAMED --add-opens java.base/java.nio=ALL-UNNAMED \
  --enable-native-access=ALL-UNNAMED \
  -Dquarkus.http.host=127.0.0.1 -Dquarkus.http.port=8888 \
  -Dquarkus.hibernate-orm.active=false \
  -Dquarkus.http.cors=true -Dquarkus.http.cors.origins=http://localhost:1420 \
  -Dsmile.daemon.engine=agent -Dsmile.daemon.llm.provider=bedrock \
  -Dsmile.daemon.llm.baseUrl=https://bedrock-mantle.us-east-1.api.aws/v1 \
  -Dsmile.daemon.llm.model=openai.gpt-oss-120b \
  -Dsmile.home=/path/to/smile/repo \
  -Dsmile.daemon.prompt="Run AutoML on input/churn.csv; maximize AUC." \
  -jar /path/to/smile/repo/serve/build/quarkus-app/quarkus-run.jar
```

Then open the frontend pointed at it: `http://localhost:1420/?ws=ws://127.0.0.1:8888/ws/run`.

## VERIFIED LIVE (2026-06-18) ✅

Full stack confirmed end-to-end against **Bedrock** (`openai.gpt-oss-120b`,
`https://bedrock-mantle.us-east-1.api.aws/v1`, `AWS_BEARER_TOKEN_BEDROCK`):
real frontend WS client → production daemon → real ioa-agent → Clair → Bedrock →
tool calls → typed protocol → three-zone UX. Screenshot:
`studio/docs/v2-live-bedrock-agent-run.png` (status Completed, real token count, the
`✅ Read churn.csv` tool-call card, Clair's streamed text). A bare-bones credential
probe returns `PONG`. (Note: `gpt-oss-120b`'s file-read tool is occasionally flaky on
small CSVs — orthogonal to the wiring, which is proven.)

## Earlier status (superseded)

Wiring is correct end-to-end **up to the LLM call**: the agent constructs, all tools load, and a completion request reaches `api.anthropic.com`. It currently returns **401 `x-api-key header is required`** because no API key is present in the daemon JVM's environment (`ANTHROPIC_API_KEY` unset). Provide credentials via the environment and re-run.

**Claude on Bedrock (OpenAI-compatible path):**

```bash
# in ~/.zshrc (or exported in the launching shell):
export AWS_BEARER_TOKEN_BEDROCK='<your-bedrock-key>'

# from a dir containing input/<dataset>.csv:
./gradlew :serve:quarkusDev -Dquarkus.http.host=127.0.0.1 \
  -Dsmile.daemon.engine=agent \
  -Dsmile.daemon.llm.provider=bedrock \
  -Dsmile.daemon.llm.baseUrl='<bedrock OpenAI-compatible endpoint>' \
  -Dsmile.daemon.llm.model='<bedrock model id>' \
  -Dsmile.home=$PWD \
  -Dsmile.daemon.prompt="Run AutoML on input/churn.csv; maximize AUC."
```

**Native Anthropic / OpenAI / Gemini:** set the matching env var (table above) and
use `-Dsmile.daemon.llm.provider=anthropic` (etc.) instead.

Manual probes (env-gated, never run in CI):
- `SMILE_AGENT_TEST=1 ... --tests smile.daemon.LlmCredentialProbeTest` — confirms credentials.
- `SMILE_AGENT_TEST=1 ... --tests smile.daemon.AgentRunSourceManualTest` — drives a real run.
