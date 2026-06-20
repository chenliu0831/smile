/**
 * Pure helpers for the SQL console's "Ask Clair / Fix" loop (Phase 3): extract the SQL
 * statements the agent has produced from the chat transcript, and decide which one to
 * inject back into the editor. Kept WASM/React-free so it is unit-testable (the SqlConsole
 * component itself can't render under jsdom because of the Perspective grid).
 */
import type { ChatTurn } from "../daemon/protocol";

/** Every SQL statement the agent produced this session, in order (kind="sql" tool-calls). */
export function agentSqlStatements(turns: ChatTurn[]): string[] {
  return turns.flatMap((t) =>
    t.toolCalls
      .filter((c) => c.kind === "sql" && !!c.code)
      .map((c) => c.code as string),
  );
}

/**
 * Given the current list of agent SQL statements and the baseline count captured when an
 * Ask/Fix request was sent, return a statement produced after the baseline (the agent's
 * answer), or null if none has arrived yet.
 *
 * @param pick "last" (default) returns the LAST new statement — the agent often runs an
 *   exploratory DESCRIBE/SELECT before the real one, so once the turn finishes the last is
 *   the intended answer. "first" returns the first new statement.
 */
export function freshAgentSql(
  statements: string[],
  baseline: number,
  pick: "first" | "last" = "last",
): string | null {
  if (statements.length <= baseline) return null;
  return pick === "last" ? statements[statements.length - 1] : statements[baseline];
}
