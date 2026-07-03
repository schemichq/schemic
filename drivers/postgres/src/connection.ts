// `@schemic/postgres/connection` — the connection surface: the structural `PgConn` a live engine
// satisfies, the `postgresConnection(...)` authoring factory for a config's `connections` map, and the
// `pgSql` safe tagged-template query builder (+ `raw`/`identifier`). SIDE-EFFECT-FREE and engine-free
// (no diff/emit/registerDriver) — so importing it, or the authoring index that re-exports it, never
// drags the migration engine into an app bundle. The actual `connect` (PGlite) lives in `./driver`.

import type {
  ConnectionConfigBase,
  ConnectionEntry,
  ConnectionInput,
  ResolveContext,
  ResolvedConfig,
} from "@schemic/core/driver";
import { connectionEntry } from "@schemic/core/driver";
// Type-only (never a runtime pull, so /connection stays engine-free); the client opener below LAZY-imports
// the real ./client at call time.
import type { PgClient } from "./client";
import { escId } from "./emit";

// A minimal structural view of a PGlite/node-postgres connection (so core needs no hard pg dep).
export interface PgConn {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}

// --- pgSql: a safe tagged-template query builder (the Postgres analogue of `surql`) -------------

/** A bound Postgres query: text with positional `$1..$n` placeholders + the values bound to them. */
export interface BoundPgQuery {
  query: string;
  params: unknown[];
}

/** A raw SQL fragment spliced VERBATIM into a `pgSql` template (NOT parameterized — caller-trusted). */
interface PgFragment {
  readonly __pgRaw: string;
}
const isFragment = (v: unknown): v is PgFragment =>
  typeof v === "object" && v !== null && "__pgRaw" in v;
const isBound = (v: unknown): v is BoundPgQuery =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as BoundPgQuery).query === "string" &&
  Array.isArray((v as BoundPgQuery).params);

/** Splice a raw SQL string verbatim (NOT parameterized — only for caller-trusted SQL). */
export function raw(sql: string): PgFragment {
  return { __pgRaw: sql };
}

/** A safely double-quoted identifier (table/column) to splice into a `pgSql` template. */
export function identifier(name: string): PgFragment {
  return { __pgRaw: escId(name) };
}

/**
 * Tagged-template SQL builder — the Postgres analogue of SurrealDB's `surql`. Interpolated values
 * become positional bind params (`$1..$n`), so values are never string-interpolated (injection-safe).
 * Wrap a value in {@link raw} / {@link identifier} to splice SQL STRUCTURE instead of a param, and a
 * nested `pgSql` composes (its placeholders renumber, its params merge). Returns a {@link BoundPgQuery}
 * — it does NOT execute; pass it to `postgresDriver.query` / `conn.query`, or nest it in another `pgSql`.
 *
 *   pgSql`SELECT * FROM ${identifier("user")} WHERE id = ${id}`
 *   // -> { query: 'SELECT * FROM "user" WHERE id = $1', params: [id] }
 */
export function pgSql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): BoundPgQuery {
  let query = "";
  const params: unknown[] = [];
  strings.forEach((str, i) => {
    query += str;
    if (i >= values.length) return;
    const v = values[i];
    if (isFragment(v)) {
      query += v.__pgRaw;
    } else if (isBound(v)) {
      // Compose: renumber the nested query's $n by the params already collected, then merge.
      query += v.query.replace(
        /\$(\d+)/g,
        (_m, n) => `$${params.length + Number(n)}`,
      );
      params.push(...v.params);
    } else {
      params.push(v);
      query += `$${params.length}`;
    }
  });
  return { query, params };
}

// --- postgresConnection: the multi-connection authoring factory ---------------------------------

/** Postgres connection params, on top of the dialect-neutral base ({schema, key?, migrations?}). */
export interface PostgresConnectionConfig extends ConnectionConfigBase {
  /**
   * Where to connect. `file:<dir>` (or a bare path) -> embedded PGlite data dir; empty/omitted ->
   * in-memory PGlite. A `postgres://` URL is reserved for a future node-postgres client.
   */
  url?: string;
}

/** The factory-embedded client opener: LAZY-import `./client` + open a MANAGED `PgClient` from the
 * resolved config. Lazy so authoring a config from this engine-free module never pulls the engine. */
const openPgClient = (config: ResolvedConfig): Promise<PgClient> =>
  import("./client").then((m) => m.clientFromResolved(config));

/** Postgres DISPLAY identity for a resolved config (bulk reporting / errors / logs) — the target `url`
 * (`file:<dir>` or `postgres://…`), else `pglite(memory)` for an in-memory connection. */
const pgLabel = (config: ResolvedConfig): string => {
  const url = config.params.url;
  return typeof url === "string" && url.length > 0 ? url : "pglite(memory)";
};

type MaybePromise<T> = T | Promise<T>;

/**
 * Typed `postgresConnection(...)` factory — the only thing a config's `connections` map accepts for
 * this driver. Wraps {@link connectionEntry} with the Postgres connection shape. Pass a static config,
 * a resolver yielding one config, or a resolver yielding a keyed COLLECTION (each entry needs `key`).
 *
 * A PARAMETERIZED connection declares its args as the resolver's SECOND parameter — that type is
 * inferred as `Args`, so `schemic.connect("<name>", args)` is typed + autocompleted per connection
 * (no args schema to plumb; annotate the param and you're done).
 */
export function postgresConnection(
  config: PostgresConnectionConfig,
): ConnectionEntry<PgClient, undefined>;
export function postgresConnection<Args = undefined>(
  resolver: (
    ctx: ResolveContext,
    args: Args,
  ) => MaybePromise<PostgresConnectionConfig>,
): ConnectionEntry<PgClient, Args>;
export function postgresConnection<Args = undefined>(
  resolver: (
    ctx: ResolveContext,
    args: Args,
  ) => MaybePromise<(PostgresConnectionConfig & { key: string })[]>,
): ConnectionEntry<PgClient, Args>;
export function postgresConnection<Args = undefined>(
  input: ConnectionInput<PostgresConnectionConfig, Args>,
): ConnectionEntry<PgClient, Args> {
  return connectionEntry<PostgresConnectionConfig, PgClient, Args>(
    "postgres",
    input,
    { client: openPgClient, label: pgLabel },
  );
}
