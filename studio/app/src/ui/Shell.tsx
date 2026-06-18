/**
 * Single-window dockview shell (ADR-0008). The topbar (chrome) sits above a
 * DockviewReact dock area. The AutoML Run view is the agent-centered HOME and
 * the default visible panel; the Notebook escape hatch and Kernel Explorer are
 * peer panels. Panels are rearrangeable/dockable (dockview default) and the
 * layout persists to localStorage, restoring on reload.
 */
import { useRef } from "react";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview";
import "dockview/dist/styles/dockview.css";
import { RunProvider, useRunContext } from "../automl/RunContext";
import { Topbar } from "./Topbar";
import { RunZones } from "./RunView";
import { NotebookPanel } from "./NotebookPanel";
import { KernelPanel } from "./KernelPanel";

const LAYOUT_KEY = "smile.studio.layout.v1";

// Panel components keyed by id. dockview instantiates these inside its panels;
// each is just our existing surface, so the Run view streams exactly as before.
const components: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  run: () => <RunZones />,
  notebook: () => <NotebookPanel />,
  kernel: () => <KernelPanel />,
};

/** Build the default layout: Run home, with Notebook + Kernel as peer tabs. */
function addDefaultPanels(event: DockviewReadyEvent) {
  const run = event.api.addPanel({
    id: "run",
    component: "run",
    title: "AutoML Run",
  });
  event.api.addPanel({
    id: "notebook",
    component: "notebook",
    title: "Notebook",
    position: { referencePanel: run, direction: "within" },
  });
  event.api.addPanel({
    id: "kernel",
    component: "kernel",
    title: "Kernel",
    position: { referencePanel: run, direction: "right" },
  });
  // Keep the agent-centered HOME visible by default.
  run.api.setActive();
}

function Dock() {
  const apiRef = useRef<DockviewReadyEvent["api"] | null>(null);

  const onReady = (event: DockviewReadyEvent) => {
    apiRef.current = event.api;

    let restored = false;
    const raw =
      typeof localStorage !== "undefined" ? localStorage.getItem(LAYOUT_KEY) : null;
    if (raw) {
      try {
        event.api.fromJSON(JSON.parse(raw));
        restored = true;
      } catch {
        // Corrupt/old layout — fall back to defaults below.
        restored = false;
      }
    }
    // Defensive: if restore yielded no panels (or failed), build the default.
    if (!restored || event.api.panels.length === 0) {
      event.api.clear();
      addDefaultPanels(event);
    }

    // Persist on any layout change (move/resize/add/remove/tab switch).
    event.api.onDidLayoutChange(() => {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(event.api.toJSON()));
      } catch {
        // localStorage unavailable (e.g. private mode) — non-fatal.
      }
    });
  };

  return (
    <DockviewReact
      className="dockview-theme-smile"
      components={components}
      onReady={onReady}
    />
  );
}

function ShellInner() {
  const { state } = useRunContext();
  return (
    <div className="app">
      <Topbar state={state} />
      <div className="dock-area">
        <Dock />
      </div>
    </div>
  );
}

export function Shell() {
  return (
    <RunProvider>
      <ShellInner />
    </RunProvider>
  );
}
