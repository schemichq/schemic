/**
 * Configuration for the `schemic` CLI. Author it in `schemic.config.ts`:
 *
 * ```ts
 * import { defineConfig } from "@schemic/core/config";
 *
 * export default defineConfig({
 *   db: {
 *     url: process.env.SURREAL_URL ?? "ws://localhost:8000",
 *     namespace: "app",
 *     database: "app",
 *     username: process.env.SURREAL_USER,
 *     password: process.env.SURREAL_PASS,
 *   },
 * });
 * ```
 *
 * `schema` and `migrations` are optional — they default to `./database/schema` and
 * `./database/migrations` (the `init` layout).
 *
 * Connection fields fall back to env (`SURREAL_URL`/`SURREAL_NAMESPACE`/`SURREAL_DATABASE`/
 * `SURREAL_USER`/`SURREAL_PASS`) and can be overridden by CLI flags at run time.
 */
/** Which level to authenticate at — mirrors `surreal sql --auth-level`. */
export type AuthLevel = "root" | "namespace" | "database";

export interface SurrealZodConnection {
  /** Endpoint, e.g. `ws://localhost:8000` or `http://localhost:8000`. */
  url: string;
  /** Target namespace. */
  namespace: string;
  /** Target database. */
  database: string;
  /** Auth username. */
  username?: string;
  /** Auth password. */
  password?: string;
  /**
   * Level to sign in at: `root` (default), `namespace`, or `database`. Determines the
   * signin payload — `namespace`/`database` scope the credentials to that ns/db.
   */
  authLevel?: AuthLevel;
}

/** An allow/deny list for a single capability — mirrors `@surrealdb/node`. */
export interface CapabilityList {
  allow?: boolean | string[];
  deny?: boolean | string[];
}

/** Capabilities for the embedded check engine — mirrors `@surrealdb/node`'s `capabilities` option. */
export interface EmbeddedCapabilities {
  scripting?: boolean;
  guest_access?: boolean;
  live_query_notifications?: boolean;
  functions?: boolean | string[] | CapabilityList;
  network_targets?: boolean | string[] | CapabilityList;
  experimental?: boolean | string[] | CapabilityList;
}

/**
 * Run `schemic check`'s replay on an EMBEDDED in-process SurrealDB via the optional `@surrealdb/node`
 * package (install it yourself — `npm i -D @surrealdb/node`). Options pass through to
 * `createNodeEngines`; `backend`/`path` choose the storage. No external server, your data untouched.
 */
export interface SurrealZodCheckEmbedded {
  /** Storage backend. `memory` (default) is throwaway in-RAM; the others persist to `path`. */
  backend?: "memory" | "surrealkv" | "surrealkv+versioned" | "rocksdb";
  /** Filesystem path for the persistent backends (ignored for `memory`). */
  path?: string;
  /** Capabilities for the instance. Default: all allowed, so asserts/defaults/functions work. */
  capabilities?: boolean | EmbeddedCapabilities;
  /** SurrealDB strict mode. */
  strict?: boolean;
  /** Query timeout. */
  query_timeout?: number;
  /** Transaction timeout. */
  transaction_timeout?: number;
}

/** `schemic check` options. */
export interface SurrealZodCheck {
  /**
   * Engine for the migration replay:
   *  - `"auto"` (default) — if the `surreal` CLI is on PATH, spin up an ephemeral in-memory instance
   *    (your EXACT SurrealDB version, no external server, your data untouched); otherwise fall back to
   *    the `check.db`/`db` server.
   *  - `"binary"` — require the local `surreal` CLI (error if it's missing).
   *  - `"remote"` — always use the `check.db`/`db` server (throwaway scratch databases on it).
   *  - an embedded object (`{ backend, capabilities, … }`) — run in-process via the optional
   *    `@surrealdb/node` package. See {@link SurrealZodCheckEmbedded}.
   */
  engine?: "auto" | "binary" | "remote" | SurrealZodCheckEmbedded;
  /** Path to the `surreal` CLI for the `auto`/`binary` engines. Default: `surreal` on PATH. */
  binary?: string;
  /**
   * Connection used for the `remote` engine, merged field-by-field over `db`. The replay spins up
   * throwaway scratch databases and drops them — it NEVER reads or writes your real database — but it
   * DOES reach the server. Point this at a local/scratch SurrealDB so `schemic check` never touches
   * production:
   *
   * ```ts
   * check: { db: { url: "ws://localhost:8000", namespace: "scratch" } }
   * ```
   *
   * Falls back to `db` for any field you omit. (`schemic check --schema` skips the replay entirely.)
   */
  db?: Partial<SurrealZodConnection>;
}

export interface SurrealZodConfig {
  /**
   * Target database driver. Default `"surrealdb"`. The multi-DB spike adds `"postgres"` (see
   * docs/MULTI-DB-SPIKE.md) — a non-surreal driver routes diff/connect/introspect through the
   * portable-IR driver layer instead of the SurrealQL pipeline.
   */
  driver?: string;
  /**
   * Directory (or single file) holding your schema modules, loaded recursively — so you can organize
   * by kind (`tables/`, `functions/`, `access/`, …). Default `./database/schema`.
   */
  schema?: string;
  /** Directory holding `.surql` migrations + their `meta/` snapshot. Default `./database/migrations`. */
  migrations?: string;
  /** SurrealDB connection. Individual fields fall back to env / CLI flags. */
  db: SurrealZodConnection;
  /** Table that records applied migrations. Defaults to `_migrations`. */
  migrationsTable?: string;
  /** Optional seed script run by `schemic seed`. */
  seed?: string;
  /** `schemic check` overrides — e.g. a dedicated connection for its migration replay. */
  check?: SurrealZodCheck;
}

/** Identity helper that types a `schemic.config.ts` default export. */
export function defineConfig(config: SurrealZodConfig): SurrealZodConfig {
  return config;
}
