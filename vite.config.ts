/// <reference types="vitest/config" />
import { defineConfig } from "vite";

// Extension build: one page (the side panel). manifest.json and background.js
// are static files in public/ and are copied as-is.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: { sidepanel: "sidepanel.html" } },
    // One bundled page with Firebase inside (MV3 forbids remote code). Size is fine for an extension.
    chunkSizeWarningLimit: 900,
  },
  test: { environment: "happy-dom" },
});
