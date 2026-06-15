import { defineConfig } from "tsup";

// CLI bin — needs a node shebang. Keep `@schemic/core` (and any driver package) external so the
// CLI and the jiti-loaded user schemas share ONE module instance of core's type registries.
export default defineConfig({
  entry: { cli: "src/cli/index.ts" },
  outDir: "lib",
  format: ["esm"],
  target: "esnext",
  dts: false,
  clean: true,
  sourcemap: false,
  external: ["@schemic/core", /^@schemic\//],
  banner: { js: "#!/usr/bin/env node" },
});
