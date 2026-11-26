import { defineConfig } from "vite";

// Serves the demo pages in fixtures/ at http://localhost:5174/
export default defineConfig({ root: "fixtures", server: { port: 5174, strictPort: true } });
