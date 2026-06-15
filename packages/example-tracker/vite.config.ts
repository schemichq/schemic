import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The shared `@schemic/core` schema is imported isomorphically here. Vite resolves
// `surrealdb` to its browser build via the package's `import` export condition.
export default defineConfig({
  root: "web",
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: "../dist", emptyOutDir: true },
});
