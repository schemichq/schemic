// The neutral MULTI-CONNECTION contract (design: docs/MULTI-CONNECTION.md). A project's config maps
// names to CONNECTIONS; each is produced by a per-driver `<driver>Connection(...)` factory that wraps
// {@link connectionEntry} with its own typed connection shape. Everything here is dialect-free — the
// CLI reads only these neutral fields; driver-specific connection params ride on the driver's own
// config type. The resolution engine (lazy DAG, fan-out, addressing) lives in the CLI layer.

type MaybePromise<T> = T | Promise<T>;

/** The dialect-neutral fields the orchestration reads off every connection config. */
export interface ConnectionConfigBase {
  /** Schema dir (the desired state + its migration files/snapshot). Shared dir = shared schema. */
  schema: string;
  /** Address within a COLLECTION (array-returning resolver) — `<name>:<key>`. Required on array entries. */
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
  args: Record<string, string>;
  env: NodeJS.ProcessEnv;
}

/**
 * The opaque, branded output of a `<driver>Connection(...)` factory — the only thing `defineConfig`'s
 * `connections` map accepts. Never hand-authored. `driver` is the package the CLI dynamically loads;
 * `resolve` always normalizes to an ARRAY (a single connection -> one element, a collection -> many).
 */
export interface ConnectionEntry {
  readonly __schemic: "connection";
  readonly driver: string;
  resolve(ctx: ResolveContext): Promise<ConnectionConfigBase[]>;
}

/** A connection factory's input: a static config, or a resolver yielding one config or a keyed collection. */
export type ConnectionInput<C extends ConnectionConfigBase> =
  | C
  | ((ctx: ResolveContext) => MaybePromise<C | (C & { key: string })[]>);

/**
 * Build a {@link ConnectionEntry} from a driver tag + a static config or resolver — the primitive each
 * driver package wraps in its typed `<driver>Connection(...)` factory (which fixes `C` to the driver's
 * own connection shape and overloads the array form to require `key`). Returns a branded entry whose
 * `resolve` always yields an array.
 */
export function connectionEntry<C extends ConnectionConfigBase>(
  driver: string,
  input: ConnectionInput<C>,
): ConnectionEntry {
  return {
    __schemic: "connection",
    driver,
    async resolve(ctx) {
      const out = typeof input === "function" ? await input(ctx) : input;
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
