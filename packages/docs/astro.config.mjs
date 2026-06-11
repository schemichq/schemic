// @ts-check
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// The marketing landing lives at "/" (src/pages/index.astro). The docs are a
// bespoke shell (src/layouts/DocsLayout.astro + src/components/docs/**), hand-
// built to match design/website.pen. No Starlight: we own the chrome.
export default defineConfig({
  site: "https://surreal-zod.dev",
  vite: {
    plugins: [tailwindcss()],
  },
});
