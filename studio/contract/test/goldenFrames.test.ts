/**
 * CALIBRATION: validate the REAL captured daemon payloads (the Candidate-2 golden-frame
 * corpus) against the contract schema. If the schema is stricter than what the live daemon
 * actually emits, THIS test fails — making schema drift loud against ground truth, not
 * against hand-written expectations.
 *
 * Fixtures live in app/src/daemon/mock/fixtures/ (real bytes captured from a live agent-mode
 * Bedrock daemon, per the mock-daemon-harness notes). This test reads them directly.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { DaemonMessage, validate, formatErrors } from "../src/index";
import { ExecResult, SqlError, DatasetInfo, TableInfo } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "..", "..", "app", "src", "daemon", "mock", "fixtures");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(FIX, name), "utf8"));
}

describe("golden-frame corpus conforms to the contract schema", () => {
  it("every WS frame in ws-summarize.jsonl matches DaemonMessage", () => {
    const lines = readFileSync(join(FIX, "ws-summarize.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter((l) => l.trim());
    expect(lines.length).toBeGreaterThan(0);

    const failures: string[] = [];
    for (const [i, line] of lines.entries()) {
      const frame = JSON.parse(line);
      const { valid, errors } = validate(DaemonMessage, frame);
      if (!valid) {
        failures.push(`frame ${i} (type=${frame.type}):\n${formatErrors(errors)}`);
      }
    }
    expect(failures, `\n${failures.join("\n\n")}`).toEqual([]);
  });

  it("tables.json matches TableInfo[] (each row)", () => {
    const rows = readJson("tables.json") as unknown[];
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) {
      const { valid, errors } = validate(TableInfo, row);
      expect(valid, formatErrors(errors)).toBe(true);
    }
  });

  it("dataset-titanic.json matches DatasetInfo", () => {
    const { valid, errors } = validate(DatasetInfo, readJson("dataset-titanic.json"));
    expect(valid, formatErrors(errors)).toBe(true);
  });

  it("sql-create.json body matches ExecResult", () => {
    const fx = readJson("sql-create.json") as { body: unknown };
    const { valid, errors } = validate(ExecResult, fx.body);
    expect(valid, formatErrors(errors)).toBe(true);
  });

  it("sql-error.json body matches SqlError", () => {
    const fx = readJson("sql-error.json") as { body: unknown };
    const { valid, errors } = validate(SqlError, fx.body);
    expect(valid, formatErrors(errors)).toBe(true);
  });
});
