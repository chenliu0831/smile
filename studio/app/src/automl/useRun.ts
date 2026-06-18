import { useEffect, useReducer, useRef, useState } from "react";
import { initialRunState, reduceRun, type RunState } from "../daemon/runState";
import { MockRunPlayer } from "../daemon/mock/player";
import { churnRunScript } from "../daemon/mock/churnRun";

export interface RunController {
  state: RunState;
  /** Answer/dismiss the currently open gate, resuming the run. */
  resolveGate: (gateId: string) => void;
}

/**
 * Drives an AutoML Run from the mock daemon into RunState. Swapping the mock player
 * for a real WebSocket client is the only change needed to go live (ADR-0002).
 */
export function useRun(): RunController {
  const [state, dispatch] = useReducer(reduceRun, initialRunState);
  const playerRef = useRef<MockRunPlayer | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const player = new MockRunPlayer(churnRunScript, { stepMs: 350 });
    playerRef.current = player;
    // Demo/screenshot aid: ?auto resolves gates automatically so the full run plays.
    const auto = typeof window !== "undefined" && window.location.search.includes("auto");
    const unsub = player.subscribe((msg) => {
      dispatch(msg);
      force((n) => n + 1);
      if (auto && msg.type === "gate-opened") {
        setTimeout(() => player.answerGate(msg.gate.id), 200);
      }
    });
    player.start();
    return () => {
      unsub();
      player.stop();
    };
  }, []);

  return {
    state,
    resolveGate: (gateId) => playerRef.current?.answerGate(gateId),
  };
}
