import { defineConfig } from "tsup";

// @schemic/core is a pure library now — no CLI bin (that's @schemic/cli). Three entries: the neutral
// engine (`.`), the config helper (`/config`), and the neutral driver SDK (`/driver`).
export default defineConfig({
  entry: {
    index: "src/index.ts",
    config: "src/config.ts",
    driver: "src/driver/sdk.ts",
  },
  outDir: "lib",
  format: ["esm"],
  target: "esnext",
  dts: true,
  clean: true,
  sourcemap: true,
});
