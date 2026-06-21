/**
 * Generates the canonical JSON Schema files from the TypeBox source of truth.
 *
 * TypeBox schema objects ARE JSON Schema (Draft 7-compatible) already, so this mostly
 * serializes them — but it INLINES referenced `$defs` so each emitted file is
 * self-contained, which the Java (networknt) and Rust (jsonschema) validators consume
 * without a shared resolver.
 *
 * Output: studio/contract/schema/*.json — committed build artifacts. Run `npm run gen`
 * after changing any schema; CI checks the committed files are up to date (gen:check).
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { TSchema } from "@sinclair/typebox";
import { DaemonMessage, WebviewReply } from "../src/daemonMessage";
import {
  SqlRequest,
  SaveRequest,
  ExecResult,
  SqlError,
  DatasetInfo,
  TableInfo,
  TablesResponse,
  ColumnTable,
} from "../src/rest";
import { LlmConfig, DaemonInfo, LoadedDataset, StagedDataset } from "../src/tauri";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "schema");

function emit(name: string, schema: TSchema): void {
  // TypeBox schemas are self-contained JSON Schema (every type is embedded by value, no
  // cross-`$ref`), so serialization is direct — each file stands alone for the Java
  // (networknt) and Rust (jsonschema) validators.
  //
  // Strip the top-level `$id`: TypeBox sets it for naming, but Draft-7 validators (networknt
  // 3.x) require `$id` to be a valid URI and reject a bare word like "DaemonMessage". The id
  // is purely cosmetic here — each file IS the named schema — so dropping it is lossless.
  const { $id: _drop, ...rest } = schema as Record<string, unknown>;
  const json = JSON.stringify(rest, null, 2) + "\n";
  const path = join(outDir, `${name}.json`);
  // gen:check passes "--check" to fail (non-zero) when a committed file is stale.
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {
      /* missing file => stale */
    }
    if (current !== json) {
      console.error(`STALE: ${name}.json is out of date — run \`npm run gen\``);
      process.exitCode = 1;
    }
    return;
  }
  writeFileSync(path, json);
  console.log(`wrote schema/${name}.json`);
}

const SCHEMAS: Array<[string, TSchema]> = [
  // Wire protocol (daemon <-> webview)
  ["DaemonMessage", DaemonMessage],
  ["WebviewReply", WebviewReply],
  // REST (daemon)
  ["SqlRequest", SqlRequest],
  ["SaveRequest", SaveRequest],
  ["ExecResult", ExecResult],
  ["SqlError", SqlError],
  ["DatasetInfo", DatasetInfo],
  ["TableInfo", TableInfo],
  ["TablesResponse", TablesResponse],
  ["ColumnTable", ColumnTable],
  // Tauri command payloads (shell <-> webview)
  ["LlmConfig", LlmConfig],
  ["DaemonInfo", DaemonInfo],
  ["LoadedDataset", LoadedDataset],
  ["StagedDataset", StagedDataset],
];

if (!process.argv.includes("--check")) mkdirSync(outDir, { recursive: true });
for (const [name, schema] of SCHEMAS) emit(name, schema);
