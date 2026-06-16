import { defineConfig } from "tsup";

// @schemic/core is a pure library now — no CLI bin (that's @schemic/cli). Entries: the neutral engine
// (`.`), the config helper (`/config`), the neutral driver SDK (`/driver`), the authoring base
// (`/authoring` — SFieldBase, what each driver's `s.*` builds on), and the driver conformance suite
// (`/testing` — bun:test-based, run by each driver against its own surface).
export default defineConfig({
  entry: {
    index: "src/index.ts",
    config: "src/config.ts",
    driver: "src/driver/sdk.ts",
    authoring: "src/authoring.ts",
    testing: "src/testing.ts",
  },
  outDir: "lib",
  format: ["esm"],
  target: "esnext",
  dts: true,
  clean: true,
  sourcemap: true,
  // `bun:test` is provided by the Bun test runtime, never bundled into the published lib.
  external: ["bun:test"],
});
