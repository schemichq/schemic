// The neutral MULTI-CONNECTION contract (design: docs/MULTI-CONNECTION.md). A project's config maps
// names to CONNECTIONS; each is produced by a per-driver `<driver>Connection(...)` factory that wraps
// {@link connectionEntry} with its own typed connection shape. Everything here is dialect-free — the
// CLI reads only these neutral fields; driver-specific connection params ride on the driver's own
// config type. The resolution engine (lazy DAG, fan-out, addressing) lives in the CLI layer.

// Type-only (erased): the resolved per-connection config a factory-embedded `client` opener receives.
import type { ResolvedConfig } from "./cli-kit/config";

type MaybePromise<T> = T | Promise<T>;

/** Minimal Standard Schema v1 surface — what a connection's `args` schema must expose. */
export interface StandardSchemaLike {
  "~standard": {
    validate(
      value: unknown,
    ): MaybePromise<
      { value: unknown } | { issues: readonly { message: string }[] }
    >;
  };
}

/** The dialect-neutral fields the orchestration reads off every connection config. */
export interface ConnectionConfigBase {
  /** Schema dir (the desired state + its migration files/snapshot). Shared dir = shared schema. */
  schema: string;
  /** Optional DISPLAY label for this config within a bulk (array) resolution — reporting/logs only. */
  key?: string;
  /** Migrations dir override; defaults relative to `schema`. */
  migrations?: string;
}

/** A live, queryable handle to ANOTHER (already-resolved) connection, for use inside a resolver. */
export interface ResolvedConnectionHandle {
  query<T = unknown>(sql: string, vars?: Record<string, unknown>): Promise<T[]>;
}

/**
 * What a connection RESOLVER receives. `connections` is a LAZY proxy of the other connections —
 * touching one resolves + connects it on demand (so the dependency graph falls out of access; cycles
 * error). `args` are CLI `--arg k=v` values (so a resolver can yield a SUBSET without resolving all).
 */
export interface ResolveContext {
  connections: Record<string, ResolvedConnectionHandle>;
  env: NodeJS.ProcessEnv;
}

/**
 * The opaque, branded output of a `<driver>Connection(...)` factory — the only thing `defineConfig`'s
 * `connections` map accepts. Never hand-authored. `driver` is the package the CLI dynamically loads;
 * `resolve` always normalizes to an ARRAY (a single connection -> one element, a collection -> many).
 */
export interface ConnectionEntry<Client = unknown, Args = undefined> {
  readonly __schemic: "connection";
  readonly driver: string;
  resolve(ctx: ResolveContext, args?: Args): Promise<ConnectionConfigBase[]>;
  /**
   * Lazily open this connection's bound ORM CLIENT for a resolved config — embedded by the driver
   * factory (with a lazy `import()` of its own client module, so authoring a config never pulls the
   * engine). This is what powers the typed `config.connect(name)` on `defineConfig`'s return.
   */
  client?(config: ResolvedConfig): Promise<Client>;
  /**
   * Dialect-specific DISPLAY identity for a resolved config (bulk reporting / errors / logs) —
   * e.g. surreal `ns/db`, pg `host/db`. Precedence: config `key` > this hook > positional `name[i]`.
   */
  label?(config: ResolvedConfig): string;
  /** PHANTOM (never assigned) — anchors `Client`/`Args` so `config.connect` can infer them per entry. */
  readonly __types?: { client: Client; args: Args };
}

/** Cross-driver erasure of the entry generics (like `AnyField`) — the shape neutral maps hold. */
// biome-ignore lint/suspicious/noExplicitAny: cross-driver erasure of the per-entry client/args types.
export type AnyConnectionEntry = ConnectionEntry<any, any>;

/** A connection factory's input: a static config, or a resolver yielding one config or a keyed collection. */
export type ConnectionInput<C extends ConnectionConfigBase, Args = undefined> =
  | C
  | ((ctx: ResolveContext, args: Args) => MaybePromise<C | C[]>);

/**
 * Build a {@link ConnectionEntry} from a driver tag + a static config or resolver — the primitive each
 * driver package wraps in its typed `<driver>Connection(...)` factory (which fixes `C` to the driver's
 * own connection shape and overloads the array form to require `key`). Returns a branded entry whose
 * `resolve` always yields an array. `extras` carries the factory-embedded client opener (for
 * `config.connect`) and the optional args schema.
 */
export function connectionEntry<
  C extends ConnectionConfigBase,
  Client = unknown,
  Args = undefined,
>(
  driver: string,
  input: ConnectionInput<C, Args>,
  extras?: {
    client?: (config: ResolvedConfig) => Promise<Client>;
    label?: (config: ResolvedConfig) => string;
  },
): ConnectionEntry<Client, Args> {
  return {
    __schemic: "connection",
    driver,
    ...(extras?.client ? { client: extras.client } : {}),
    ...(extras?.label ? { label: extras.label } : {}),
    async resolve(ctx, args) {
      const out =
        typeof input === "function" ? await input(ctx, args as Args) : input;
      return Array.isArray(out) ? out : [out];
    },
  };
}

/** Type guard: is a `connections` map value a real factory output (vs a stray object)? */
export function isConnectionEntry(v: unknown): v is ConnectionEntry {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { __schemic?: unknown }).__schemic === "connection"
  );
}
