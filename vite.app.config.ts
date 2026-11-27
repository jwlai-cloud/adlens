import { defineConfig } from "vite";

// AdLens Live web app (Firebase Hosting). The Chrome extension builds with vite.config.ts.
export default defineConfig({
  publicDir: "app-public",
  build: { outDir: "dist-app", emptyOutDir: true, chunkSizeWarningLimit: 1200, rollupOptions: { input: "index.html" } },
  server: { port: 5176, strictPort: true },
});
