import { defineConfig } from "surreal-zod/config";

export default defineConfig({
  // schema and migrations default to ./database/schema and ./database/migrations.
  // schema/ is loaded recursively — organize by kind: tables/, functions/, access/, …
  // schema: "./database/schema",
  // migrations: "./database/migrations",
  db: {
    url: process.env.SURREAL_URL ?? "ws://localhost:8000",
    namespace: process.env.SURREAL_NAMESPACE ?? "app",
    database: process.env.SURREAL_DATABASE ?? "app",
    username: process.env.SURREAL_USER,
    password: process.env.SURREAL_PASS,
    authLevel: "root", // "root" | "namespace" | "database"
  },
  // `sz check` replays your migrations to confirm they reproduce the schema. By default ("auto") it
  // spins up an ephemeral in-memory SurrealDB from your local `surreal` CLI — your exact version, no
  // external server, your real database untouched. Falls back to the `db` server if the CLI is
  // missing. To always use a server (and keep it off production) point the replay at a scratch one:
  // check: { engine: "remote", db: { url: "ws://localhost:8000", namespace: "scratch" } },
  // Or run fully in-process via the optional @surrealdb/node package (npm i -D @surrealdb/node):
  // check: { engine: { backend: "memory" } }, // backend: memory | surrealkv | rocksdb, + capabilities
});
