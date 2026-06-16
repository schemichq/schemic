import { defineConfig } from "@schemic/core/config";
import { surrealConnection } from "@schemic/surrealdb";

// Connections-only config: each named connection is produced by the driver's `surrealConnection(...)`
// factory, so there's no `driver: "…"` string to keep in sync. Values are explicit — read env here
// yourself (no implicit SURREAL_* magic). Add more named connections for multi-tenant / multi-DB
// setups and address them with `schemic --connection <name>` (or `--all`).
export default defineConfig({
  connections: {
    default: surrealConnection({
      schema: "./database/schema", // s.* models, loaded recursively (organize by kind: tables/, functions/, …)
      url: process.env.SURREAL_URL ?? "ws://localhost:8000",
      namespace: process.env.SURREAL_NAMESPACE ?? "app",
      database: process.env.SURREAL_DATABASE ?? "app",
      username: process.env.SURREAL_USER,
      password: process.env.SURREAL_PASS,
      authLevel: "root", // "root" | "namespace" | "database"
      // `schemic check` replays your migrations to confirm they reproduce the schema. By default
      // ("auto") it spins up an ephemeral in-memory SurrealDB from your local `surreal` CLI — your
      // exact version, no external server, your real database untouched. Point it at a scratch server:
      // check: { engine: "remote", db: { url: "ws://localhost:8000", namespace: "scratch" } },
      // Or run fully in-process via the optional @surrealdb/node package (npm i -D @surrealdb/node):
      // check: { engine: { backend: "memory" } },
    }),
  },
});
