import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  outDir: "lib",
  format: ["esm"],
  target: "esnext",
  dts: true,
  clean: true,
  sourcemap: true,
  // Keep @schemic/core external — one shared module instance (its registries/WeakMaps must match).
  external: ["@schemic/core", /^@schemic\/core\//, "@electric-sql/pglite"],
});
