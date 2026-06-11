// @ts-check
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://surreal-zod.dev",
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    starlight({
      title: "surreal-zod",
      description:
        "Author SurrealDB schemas in TypeScript with Zod. Generate SurrealQL DDL, infer end-to-end types, and run safe migrations.",
      // Fonts (fontsource) load first so the @theme stack below can reference them.
      customCss: [
        "@fontsource-variable/geist",
        "@fontsource-variable/geist-mono",
        "./src/styles/global.css",
      ],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/msanchezdev/surreal-zod",
        },
        {
          icon: "discord",
          label: "SurrealDB Discord",
          href: "https://surrealdb.com/discord",
        },
      ],
      // The marketing landing lives at "/" (src/pages/index.astro), outside
      // Starlight's chrome. Starlight owns the documentation routes below.
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Introduction", slug: "introduction" },
            { label: "Getting started", slug: "getting-started" },
          ],
        },
        {
          label: "Guides",
          items: [{ autogenerate: { directory: "guides" } }],
        },
        {
          label: "Reference",
          items: [{ autogenerate: { directory: "reference" } }],
        },
      ],
    }),
  ],
});
