import { defineConfig } from "@schemic/core/config";
import { surrealConnection } from "@schemic/surrealdb";

/**
 * Schemic CLI config for the tracker dogfood — connections-only.
 *
 * `schema` points at `./src` — the loader scans it for exported `TableDef`s, picking up the
 * seven tables/relations from `src/schema.ts` (and ignoring `src/db.ts`, which exports none).
 * Connection params are explicit here (read env yourself); migrations live under ./database/migrations.
 */
export default defineConfig({
  connections: {
    default: surrealConnection({
      schema: "./src",
      migrations: "./database/migrations",
      url: process.env.SURREAL_URL ?? "ws://localhost:8000",
      namespace: process.env.SURREAL_NAMESPACE ?? "tracker",
      database: process.env.SURREAL_DATABASE ?? "main",
      username: process.env.SURREAL_USER ?? "root",
      password: process.env.SURREAL_PASS,
      authLevel: "root",
    }),
  },
});
