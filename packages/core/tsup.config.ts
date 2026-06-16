import { defineConfig } from "tsup";

// @schemic/core is a pure library now — no CLI bin (that's @schemic/cli). Entries: the neutral engine
// (`.`), the config helper (`/config`), the neutral driver SDK (`/driver`), and the authoring base
// (`/authoring` — SFieldBase, what each driver's `s.*` builds on).
export default defineConfig({
  entry: {
    index: "src/index.ts",
    config: "src/config.ts",
    driver: "src/driver/sdk.ts",
    authoring: "src/authoring.ts",
  },
  outDir: "lib",
  format: ["esm"],
  target: "esnext",
  dts: true,
  clean: true,
  sourcemap: true,
});
