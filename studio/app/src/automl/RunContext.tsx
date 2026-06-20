/**
 * Provides a single AutoML Run instance to the whole shell. The topbar (chrome,
 * outside the dock) and the Run panel (inside the dock) both read the same
 * RunController, so there is exactly one MockRunPlayer driving one RunState.
 */
import { createContext, useContext, type ReactNode } from "react";
import { useRun, type RunController } from "./useRun";
import type { connectRun } from "../daemon/connect";

const RunContext = createContext<RunController | null>(null);

/**
 * @param connect optional connection factory (defaults to the real `connectRun`). The
 *   replay-fixture test harness passes a fixture-backed factory so the entire tree renders
 *   against captured daemon frames with no live backend.
 */
export function RunProvider({
  children,
  connect,
}: {
  children: ReactNode;
  connect?: typeof connectRun;
}) {
  const controller = useRun(connect);
  return <RunContext.Provider value={controller}>{children}</RunContext.Provider>;
}

export function useRunContext(): RunController {
  const ctx = useContext(RunContext);
  if (!ctx) throw new Error("useRunContext must be used within a RunProvider");
  return ctx;
}
