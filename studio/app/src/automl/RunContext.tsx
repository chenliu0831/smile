/**
 * Provides a single AutoML Run instance to the whole shell. The topbar (chrome,
 * outside the dock) and the Run panel (inside the dock) both read the same
 * RunController, so there is exactly one MockRunPlayer driving one RunState.
 */
import { createContext, useContext, type ReactNode } from "react";
import { useRun, type RunController } from "./useRun";

const RunContext = createContext<RunController | null>(null);

export function RunProvider({ children }: { children: ReactNode }) {
  const controller = useRun();
  return <RunContext.Provider value={controller}>{children}</RunContext.Provider>;
}

export function useRunContext(): RunController {
  const ctx = useContext(RunContext);
  if (!ctx) throw new Error("useRunContext must be used within a RunProvider");
  return ctx;
}
