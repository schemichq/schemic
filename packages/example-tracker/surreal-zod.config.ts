import { defineConfig } from "surreal-zod/config";

/**
 * surreal-zod migration CLI config for the tracker dogfood.
 *
 * `schema` points at `./src` — the loader scans it for exported `TableDef`s, picking up the
 * seven tables/relations from `src/schema.ts` (and ignoring `src/db.ts`, which exports none).
 * Migrations live under `./database/migrations`. Connection fields fall back to the `.env`
 * the CLI loads from this directory (SURREAL_URL / SURREAL_NAMESPACE / SURREAL_DATABASE / …).
 */
export default defineConfig({
  schema: "./src",
  migrations: "./database/migrations",
  db: {
    url: process.env.SURREAL_URL ?? "ws://localhost:8000",
    namespace: process.env.SURREAL_NAMESPACE ?? "tracker",
    database: process.env.SURREAL_DATABASE ?? "main",
    username: process.env.SURREAL_USER ?? "root",
    password: process.env.SURREAL_PASS,
    authLevel: "root",
  },
});
