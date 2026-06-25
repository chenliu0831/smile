import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// jsdom has no ResizeObserver; dockview's grid requires it. Minimal no-op stub
// so the dockview shell can mount under jsdom (it never actually resizes in tests).
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom has no <canvas> 2D context, so ECharts' async render loop throws "clearRect of null"
// AFTER a test completes (an uncaught exception, not a failure). Now that ANY numeric report
// table mounts a Report Chart (ADR-0016), many UATs that render a report would trip it. Stub
// ECharts globally to a marker div — the same discipline as the ResizeObserver stub above.
// Tests that need to assert the chart `option`/`onEvents` declare their own richer
// `vi.mock("echarts-for-react")`, which is hoisted within that file and takes precedence.
vi.mock("echarts-for-react", () => ({ default: () => null }));
