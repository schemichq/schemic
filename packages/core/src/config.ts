/**
 * Configuration for the `schemic` CLI — author it in `schemic.config.ts`.
 *
 * A project declares one or more named CONNECTIONS, each built by a per-driver factory
 * (`<driver>Connection(...)` exported from `@schemic/<driver>/connection`). Connection values are EXPLICIT —
 * there is no env-var magic; read env yourself where you want it (`url: process.env.MY_URL`).
 * See `@schemic/core` docs/MULTI-CONNECTION.md.
 *
 * ```ts
 * import { defineConfig } from "@schemic/core/config";
 * import { surrealConnection } from "@schemic/surrealdb/connection";
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
import type { AnyConnectionEntry, ConnectionEntry } from "./connection";

export interface SchemicConfig {
  /** Named database connections — each produced by a per-driver `<driver>Connection(...)` factory. */
  connections: Record<string, AnyConnectionEntry>;
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

/** The bound ORM client type a {@link ConnectionEntry} opens (inferred from the driver factory). */
// biome-ignore lint/suspicious/noExplicitAny: matching the erased Args slot.
export type EntryClient<E> =
  E extends ConnectionEntry<infer Client, any> ? Client : never;
/** The typed resolver `args` a {@link ConnectionEntry} accepts (from its `args` schema). */
// biome-ignore lint/suspicious/noExplicitAny: matching the erased Client slot.
export type EntryArgs<E> =
  E extends ConnectionEntry<any, infer Args> ? Args : never;

/** Options for `config.connect(name, opts)` — element key, typed resolver args, working dir. */
export interface ConnectOptions<
  Args extends Record<string, unknown> = Record<string, string>,
> {
  /** Address one element of a keyed collection (`<name>:<key>`). */
  key?: string;
  /** Resolver args — validated against the connection's `args` schema when it declares one. */
  args?: Args;
  /** Working directory relative paths resolve from (defaults to `process.cwd()`). */
  cwd?: string;
}

/**
 * What {@link defineConfig} ADDS to your config: the config IS the app's typed entry point to its
 * databases. `connect(name)` autocompletes your connection names, returns that entry's own client
 * type (a heterogeneous-driver project types per-connection), and validates `args` per the entry's
 * schema. The client is disposable: `await using db = await schemic.connect()`.
 */
export interface SchemicProject<
  Conns extends Record<string, AnyConnectionEntry>,
> {
  connect<N extends keyof Conns & string>(
    name?: N,
    opts?: ConnectOptions<EntryArgs<Conns[N]>>,
  ): Promise<EntryClient<Conns[N]>>;
}

/**
 * Type + enrich a Schemic config: returns the config with a typed `connect()` attached — the config
 * itself is the factory. The loader accepts a `default` export OR the NAMED `schemic` export; the
 * scaffolded form is the named one (deterministic auto-import, no file rename needed):
 *
 * ```ts
 * // schemic.config.ts (a bare schemic.ts also works)
 * export const schemic = defineConfig({ connections: { ... } });
 * // app code: import { schemic } from "./schemic.config";  →  await using db = await schemic.connect();
 * ```
 */
export function defineConfig<const C extends SchemicConfig>(
  config: C,
): C & SchemicProject<C["connections"]> {
  return {
    ...config,
    async connect(name?: string, opts?: ConnectOptions) {
      // Lazy: authoring/loading a config stays light; the client machinery loads only when used.
      const { connectFromConfig } = await import("./client");
      return connectFromConfig(config, name, opts);
    },
  } as C & SchemicProject<C["connections"]>;
}
