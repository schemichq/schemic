import { defineConfig } from "@schemic/core/config";
import { postgresConnection } from "@schemic/postgres";

// Connections-only config: the single-connection `db` sugar is gone — a project is a map of named
// CONNECTIONS, each produced by a driver's `<driver>Connection(...)` factory. Connection VALUES are
// explicit; read env yourself here (no magic env vars).
export default defineConfig({
  connections: {
    default: postgresConnection({
      schema: "./schema",
      // PGlite (embedded): a `file:<dir>` URL is a persistent data dir; "" is in-memory. Point
      // DATABASE_URL at a real server (`postgres://…`) once the node-postgres client lands.
      url: process.env.DATABASE_URL ?? "file:./.pgdata",
    }),
  },
});
