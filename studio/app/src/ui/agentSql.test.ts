import { describe, expect, test } from "vitest";
import { agentSqlStatements, freshAgentSql } from "./agentSql";
import type { ChatTurn, ToolCall } from "../daemon/protocol";

function sqlCall(code: string): ToolCall {
  return { id: code, title: "SQL", kind: "sql", status: "done", code };
}
function agentTurn(calls: ToolCall[]): ChatTurn {
  return { id: "t", role: "agent", text: "", toolCalls: calls, status: "done" };
}

describe("agentSqlStatements", () => {
  test("extracts kind=sql tool-call code across turns, in order", () => {
    const turns: ChatTurn[] = [
      { id: "u", role: "user", text: "hi", toolCalls: [], status: "done" },
      agentTurn([
        { id: "a", title: "Read", kind: "read", status: "done", code: "cat x" },
        sqlCall("SELECT 1"),
      ]),
      agentTurn([sqlCall("SELECT 2 FROM t")]),
    ];
    expect(agentSqlStatements(turns)).toEqual(["SELECT 1", "SELECT 2 FROM t"]);
  });

  test("ignores sql tool-calls without code (still running)", () => {
    const turns = [agentTurn([{ id: "a", title: "SQL", kind: "sql", status: "running" }])];
    expect(agentSqlStatements(turns)).toEqual([]);
  });
});

describe("freshAgentSql", () => {
  test("returns null until a new statement arrives", () => {
    expect(freshAgentSql(["old"], 1)).toBeNull();
  });
  test("defaults to the LAST new statement (the agent explores, then writes the answer)", () => {
    // baseline 1: an exploratory DESCRIBE then the real query both arrive this turn.
    expect(freshAgentSql(["old", "DESCRIBE t", "SELECT * FROM t"], 1)).toBe("SELECT * FROM t");
  });
  test("with a single new statement, returns it", () => {
    expect(freshAgentSql(["old", "answer"], 1)).toBe("answer");
  });
  test('"first" mode returns the first new statement', () => {
    expect(freshAgentSql(["old", "first-new", "second-new"], 1, "first")).toBe("first-new");
  });
});
