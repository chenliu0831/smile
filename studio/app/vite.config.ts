/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
