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
import type {
  AnyConnectionEntry,
  ConnectionConfigBase,
  ConnectionEntry,
  ConnectionInput,
  ResolveContext,
  ResolvedConnectionHandle,
} from "./connection";

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

/**
 * What {@link defineConfig} ADDS to your config: the config IS the app's typed entry point to its
 * databases. `connect(name, args?)` autocompletes your connection names, types `args` per connection
 * (the resolver's declared 2nd param — absent for a static/argless connection), and returns that
 * entry's own client type (a heterogeneous-driver project types per-connection). A PARAMETERIZED
 * connection whose resolver returns an ARRAY is bulk-only: `connect` throws a teaching error — pass
 * `args` selecting ONE config. The client is disposable: `await using db = await schemic.connect()`.
 */
export interface SchemicProject<
  Conns extends Record<string, AnyConnectionEntry>,
> {
  connect<N extends keyof Conns & string>(
    name?: N,
    args?: EntryArgs<Conns[N]>,
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
/**
 * A resolver's `ctx` in the CHAINED form: `connections` is typed with the ACCUMULATED prior
 * connections — each handle is thenable to that entry's FULL ORM client (`const main = await
 * ctx.connections.main; main.select(...)`) and keeps a direct `.query`. Order = visibility: a
 * resolver only sees connections declared BEFORE it (structural cycle prevention). Do not stash a
 * sibling client — it is closed when resolution settles.
 */
export type ChainCtx<Conns extends Record<string, AnyConnectionEntry>> = Omit<
  ResolveContext,
  "connections"
> & {
  connections: {
    [K in keyof Conns]: PromiseLike<EntryClient<Conns[K]>> &
      ResolvedConnectionHandle;
  };
};

/** The shape a driver connection factory must have to be used as the `.connection()` driver marker. */
export interface ChainableDriverFactory<
  C extends ConnectionConfigBase,
  Client,
> {
  // biome-ignore lint/suspicious/noExplicitAny: the chain re-types input/args itself (variance cast).
  (input: ConnectionInput<C, any>): ConnectionEntry<Client, any>;
}

/**
 * The CHAINED config builder (`defineConfig().connection(...)`): each `.connection(name, factory,
 * input)` uses the driver FACTORY ITSELF as the driver marker and contextually types the resolver's
 * `ctx.connections` with everything declared so far. The literal `defineConfig({ connections })`
 * form remains for static maps.
 */
export interface ChainedConfig<Conns extends Record<string, AnyConnectionEntry>>
  extends SchemicProject<Conns> {
  connections: Conns;
  defaultConnection?: string;
  migrationsTable?: string;
  seed?: string;
  connection<
    N extends string,
    C extends ConnectionConfigBase,
    Client,
    Args = undefined,
  >(
    name: N,
    factory: ChainableDriverFactory<C, Client>,
    input:
      | C
      | ((ctx: ChainCtx<Conns>, args: Args) => C | C[] | Promise<C | C[]>),
  ): ChainedConfig<Conns & { [K in N]: ConnectionEntry<Client, Args> }>;
}

/** Start a CHAINED config: `defineConfig().connection("main", surrealConnection, {...})`. */
export function defineConfig(
  base?: Omit<SchemicConfig, "connections">,
): ChainedConfig<Record<never, never>>;
/** Type + enrich a literal config — returns it with the typed `connect()` attached. */
export function defineConfig<const C extends SchemicConfig>(
  config: C,
): C & SchemicProject<C["connections"]>;
export function defineConfig(
  config?: SchemicConfig | Omit<SchemicConfig, "connections">,
): unknown {
  const isLiteral = !!config && "connections" in config;
  const base: SchemicConfig = isLiteral
    ? (config as SchemicConfig)
    : {
        ...(config as Omit<SchemicConfig, "connections"> | undefined),
        connections: {},
      };

  const withApi = (cfg: SchemicConfig): unknown => ({
    ...cfg,
    async connect(name?: string, args?: unknown) {
      // Lazy: authoring/loading a config stays light; the client machinery loads only when used.
      const { connectFromConfig } = await import("./client");
      return connectFromConfig(cfg, name, args);
    },
    connection(
      name: string,
      factory: (input: unknown) => AnyConnectionEntry,
      input: unknown,
    ) {
      // The factory IS the driver marker: it stamps the driver tag, config type, and client opener.
      // The chain re-types ctx/args itself, so the factory is called through a variance cast.
      const entry = factory(input as never);
      return withApi({
        ...cfg,
        connections: { ...cfg.connections, [name]: entry },
      });
    },
  });

  return withApi(base);
}
