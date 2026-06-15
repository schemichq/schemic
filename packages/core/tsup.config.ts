import { defineConfig } from "tsup";

export default defineConfig([
  // Library + config helper (consumed via `import`).
  {
    entry: { index: "src/index.ts", config: "src/config.ts" },
    outDir: "lib",
    format: ["esm"],
    target: "esnext",
    dts: true,
    clean: true,
    sourcemap: true,
  },
  // CLI bin — needs a node shebang. Keep `@schemic/core` external (don't bundle a second copy
  // of core) so the CLI and the jiti-loaded schemas share one module instance — its codec
  // type registries (WeakMaps) must match for `datetime`/`recordId` inference to work.
  {
    entry: { cli: "src/cli/index.ts" },
    outDir: "lib",
    format: ["esm"],
    target: "esnext",
    dts: false,
    clean: false,
    sourcemap: false,
    external: ["@schemic/core", /^@schemic\/core\//],
    banner: { js: "#!/usr/bin/env node" },
  },
]);
