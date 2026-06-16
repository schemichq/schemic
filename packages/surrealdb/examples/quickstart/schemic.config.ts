import { defineConfig } from "@schemic/core/config";
import { surrealConnection } from "@schemic/surrealdb";

// Connections-only config: each named connection is produced by a driver's `<driver>Connection(...)`
// factory, so there's no `driver: "…"` string to keep in sync. Values are explicit — read env here
// yourself (no implicit SURREAL_* magic). Add more named connections for multi-tenant / multi-DB setups.
export default defineConfig({
  connections: {
    default: surrealConnection({
      schema: "./schema", // s.* models, loaded recursively (organize by kind: tables/, functions/, …)
      url: process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc",
      namespace: process.env.SURREAL_NAMESPACE ?? "demo",
      database: process.env.SURREAL_DATABASE ?? "quickstart",
      username: process.env.SURREAL_USER ?? "root",
      password: process.env.SURREAL_PASS ?? "root",
      authLevel: "root", // "root" | "namespace" | "database"
    }),
  },
});
