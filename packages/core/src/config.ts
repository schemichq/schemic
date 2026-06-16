/**
 * Configuration for the `schemic` CLI — author it in `schemic.config.ts`.
 *
 * A project declares one or more named CONNECTIONS, each built by a per-driver factory
 * (`<driver>Connection(...)` exported from `@schemic/<driver>`). Connection values are EXPLICIT —
 * there is no env-var magic; read env yourself where you want it (`url: process.env.MY_URL`).
 * See `@schemic/core` docs/MULTI-CONNECTION.md.
 *
 * ```ts
 * import { defineConfig } from "@schemic/core/config";
 * import { surrealConnection } from "@schemic/surrealdb";
 *
 * export default defineConfig({
 *   connections: {
 *     default: surrealConnection({
 *       schema: "./database/schema",
 *       url: "ws://localhost:8000",
 *       namespace: "app",
 *       database: "app",
 *     }),
 *   },
 * });
 * ```
 *
 * For MULTIPLE databases (multi-tenant / heterogeneous / DB-per-user), add more named connections;
 * a connection may be a resolver (incl. an array → a collection). See docs/MULTI-CONNECTION.md.
 *
 * NOTE: this file is dialect-NEUTRAL. Driver-specific connection shapes (SurrealDB's
 * url/namespace/authLevel, its check-engine options, …) live in the driver package's
 * `<driver>Connection` factory, not here.
 */
import type { ConnectionEntry } from "./connection";

export interface SchemicConfig {
  /** Named database connections — each produced by a per-driver `<driver>Connection(...)` factory. */
  connections: Record<string, ConnectionEntry>;
  /**
   * With more than one connection, the connection a bare command targets (must name a single static
   * connection). Absent + ambiguous → a live command errors asking for `--connection`.
   */
  defaultConnection?: string;
  /** Table that records applied migrations (per connection). Default `_migrations`. */
  migrationsTable?: string;
  /** Optional seed script run by `schemic seed`. */
  seed?: string;
}

/** Identity helper that types a `schemic.config.ts` default export. */
export function defineConfig(config: SchemicConfig): SchemicConfig {
  return config;
}
