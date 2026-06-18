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
