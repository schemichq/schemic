import { defineConfig } from "@schemic/core/config";
import { surrealConnection } from "@schemic/surrealdb";

// Connections-only config: the `surrealConnection(...)` factory binds this connection to the SurrealDB
// driver (no `driver: "…"` string). Values are explicit — read env here yourself.
export default defineConfig({
  connections: {
    default: surrealConnection({
      schema: "./database/schema",
      url: process.env.SURREAL_URL ?? "ws://localhost:8000",
      namespace: process.env.SURREAL_NAMESPACE ?? "app",
      database: process.env.SURREAL_DATABASE ?? "app",
      username: process.env.SURREAL_USER,
      password: process.env.SURREAL_PASS,
    }),
  },
});
