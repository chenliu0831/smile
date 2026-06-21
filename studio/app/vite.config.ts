/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The shared contract module is consumed from source (no build step). Keeps front and
      // back loosely coupled: one definition of the wire shapes, imported by the app and
      // validated by the daemon/shell via the generated JSON Schema.
      "@smile/contract": fileURLToPath(new URL("../contract/src/index.ts", import.meta.url)),
    },
  },
  // Tauri expects a fixed port and no clearing of the screen for its CLI.
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // Perspective's d3fc plugin uses top-level await (and Perspective ships WASM/workers),
  // so both the dev pre-bundle and the production build must target a TLA-capable env.
  esbuild: { target: "esnext" },
  optimizeDeps: { esbuildOptions: { target: "esnext" } },
  build: { target: "esnext" },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
