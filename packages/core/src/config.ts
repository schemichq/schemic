/**
 * Configuration for the `surreal-zod` CLI. Author it in `surreal-zod.config.ts`:
 *
 * ```ts
 * import { defineConfig } from "surreal-zod/config";
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
 * `schema` and `migrations` are optional — they default to `./database/schemas` and
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

/** `sz check` options. */
export interface SurrealZodCheck {
  /**
   * Engine for the migration replay:
   *  - `"auto"` (default) — if the `surreal` CLI is on PATH, spin up an ephemeral in-memory instance
   *    (your EXACT SurrealDB version, no external server, your data untouched); otherwise fall back to
   *    the `check.db`/`db` server.
   *  - `"binary"` — require the local `surreal` CLI (error if it's missing).
   *  - `"remote"` — always use the `check.db`/`db` server (throwaway scratch databases on it).
   */
  engine?: "auto" | "binary" | "remote";
  /** Path to the `surreal` CLI for the `auto`/`binary` engines. Default: `surreal` on PATH. */
  binary?: string;
  /**
   * Connection used for the `remote` engine, merged field-by-field over `db`. The replay spins up
   * throwaway scratch databases and drops them — it NEVER reads or writes your real database — but it
   * DOES reach the server. Point this at a local/scratch SurrealDB so `sz check` never touches
   * production:
   *
   * ```ts
   * check: { db: { url: "ws://localhost:8000", namespace: "scratch" } }
   * ```
   *
   * Falls back to `db` for any field you omit. (`sz check --schema` skips the replay entirely.)
   */
  db?: Partial<SurrealZodConnection>;
}

export interface SurrealZodConfig {
  /** Directory holding your Zod schema modules (loaded recursively). Default `./database/schemas`. */
  schema?: string;
  /** Directory holding `.surql` migrations + their `meta/` snapshot. Default `./database/migrations`. */
  migrations?: string;
  /** SurrealDB connection. Individual fields fall back to env / CLI flags. */
  db: SurrealZodConnection;
  /** Table that records applied migrations. Defaults to `_migrations`. */
  migrationsTable?: string;
  /** Optional seed script run by `surreal-zod seed`. */
  seed?: string;
  /** `sz check` overrides — e.g. a dedicated connection for its migration replay. */
  check?: SurrealZodCheck;
}

/** Identity helper that types a `surreal-zod.config.ts` default export. */
export function defineConfig(config: SurrealZodConfig): SurrealZodConfig {
  return config;
}
