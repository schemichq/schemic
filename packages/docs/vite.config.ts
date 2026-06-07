import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    port: 40787,
  },
  // Pre-bundle the CJS leaf packages in fumadocs' markdown/highlight chain. Under bun's
  // isolated install layout Vite otherwise serves them raw, breaking ESM default interop
  // ("does not provide an export named 'default'").
  optimizeDeps: {
    include: ["debug", "extend", "style-to-js"],
  },
  plugins: [
    mdx(await import("./source.config")),
    tailwindcss(),
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tanstackStart({
      prerender: {
        enabled: true,
      },
    }),
    react(),
    // see https://tanstack.com/start/latest/docs/framework/react/guide/hosting for hosting config
    // we configured nitro by default
    nitro(),
  ],
});
