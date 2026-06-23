# Interactive cockpit: DuckDB materializes, the browser computes; structured payloads ride a typed `meta` field

## Context

Turning the flat report viewer into an explorable cockpit (Predictions Studio, Scorecard, Driver Diagnostics) needs two things the current contract lacks: a home for the per-row prediction data the interactive views compute over, and a home for the small structured payloads (`final_metrics.json`, the permutation-importance array) that drive the metric strip and the importance chart. There is exactly **one** synchronized in-memory DuckDB connection in the JVM, owned by the agent and shared with the Webview via `SharedSql` → `/sql` and `/data/{ref}`; there is no client-side DuckDB.

## Decision

**Compute boundary — DuckDB materializes once, the browser computes the interactive math.** The daemon does the one-time work: materializes `submission` from `read_csv_auto(...)` and bulk-serves the rows via the existing `/data/{ref}` path. (Implemented in S2 as `CREATE OR REPLACE TABLE`, not a VIEW: `/data/{ref}` resolves a name via `duckdb_tables()`, which lists tables but not views, and a table reads the CSV exactly once.) All per-interaction math — ROC sweeps, confusion-at-threshold, F1, the dragged-threshold readouts — recomputes in client JS over the in-memory rows. The ~5-row permutation-importance array is carried **inline**, with no DuckDB call at all.

**Contract — one typed structured field, two new kinds.** Add a single optional `meta?: Json` field to `Artifact` (one positional edit to the Java `record Artifact`, ~5 call sites, guarded by `ContractConformanceTest`). Structured payloads (`metrics`, `diagnostics`) ride `meta`; `body` reverts to markdown / `data:` URIs only and is no longer polymorphic. Add exactly two `ArtifactKind` literals — `metrics` and `diagnostics` — each 1:1 with a distinct renderer. Predictions reuse the existing `dataframe` kind (via `data: ArrowRef`) and the board reuses the existing `leaderboard` kind; neither needs a new kind.

## Considered Options

- **Push every ROC/confusion recompute through DuckDB SQL.** Rejected: each slider tick would contend for the single synchronized JDBC connection — the exact hazard `SqlConsole.tsx` already engineers around with turn-boundary refresh — for data (179 rows) that is trivially client-computable.
- **Add client-side duckdb-wasm** so the browser gets its own connection. Rejected: duplicates the engine and ships a large WASM bundle; the data still has to cross the wire once, and 179 rows need no engine.
- **Overload `body: string` with JSON-as-string** (the research doc's plan). Rejected: leaves `body` a junk-drawer (markdown | base64 | JSON) disambiguated only by `kind`, with no schema-level guarantee it parses.
- **Per-kind typed payloads** (`metrics?: MetricsPayload`, `diagnostics?: DiagPayload`). Rejected: most fields and churn, least consolidated.

## Consequences

- Predictions Studio needs **zero** new contract field — it rides the existing `data: ArrowRef` + `/data/{ref}` path.
- A pure, React-free `lib/` module computes ROC/confusion (mirrors `lib/leaderboard.ts`); the threshold slider never hits the network.
- `meta` is schema-describable, so a future structured kind reuses one well-defined channel instead of minting fields.
