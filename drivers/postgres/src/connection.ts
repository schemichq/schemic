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
  StandardSchemaLike,
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

/**
 * Typed `postgresConnection(...)` factory — the only thing a config's `connections` map accepts for
 * this driver. Wraps {@link connectionEntry} with the Postgres connection shape. Pass a static config,
 * a resolver yielding one config, or a resolver yielding a keyed COLLECTION (each entry needs `key`).
 */
/** Extract a Standard-Schema's OUTPUT type (Zod/valibot/etc. carry `~standard.types.output`); fall back
 * to the default `Record<string, string>` resolver-args shape when there's no args schema. */
type ArgsOut<A> = A extends { "~standard": { types?: { output?: infer O } } }
  ? O extends Record<string, unknown>
    ? O
    : Record<string, string>
  : Record<string, string>;
/** The resolved per-factory Args (a schema's output, else the string-map default). */
type Resolved<A> = [A] extends [never] ? Record<string, string> : ArgsOut<A>;

/** The factory-embedded client opener: LAZY-import `./client` + open a MANAGED `PgClient` from the
 * resolved config. Lazy so authoring a config from this engine-free module never pulls the engine. */
const openPgClient = (config: ResolvedConfig): Promise<PgClient> =>
  import("./client").then((m) => m.clientFromResolved(config));

/** Options for {@link postgresConnection}: a Standard-Schema validating this connection's resolver args. */
export interface PostgresConnectionOpts<A extends StandardSchemaLike> {
  /** Validates `config.connect(name, { args })`; the resolver's `ctx.args` is typed as its output. */
  args?: A;
}

export function postgresConnection<A extends StandardSchemaLike = never>(
  config: PostgresConnectionConfig,
  opts?: PostgresConnectionOpts<A>,
): ConnectionEntry<PgClient, Resolved<A>>;
export function postgresConnection<A extends StandardSchemaLike = never>(
  resolver: (
    ctx: ResolveContext & { args: Resolved<A> },
  ) => PostgresConnectionConfig | Promise<PostgresConnectionConfig>,
  opts?: PostgresConnectionOpts<A>,
): ConnectionEntry<PgClient, Resolved<A>>;
export function postgresConnection<A extends StandardSchemaLike = never>(
  resolver: (
    ctx: ResolveContext & { args: Resolved<A> },
  ) =>
    | (PostgresConnectionConfig & { key: string })[]
    | Promise<(PostgresConnectionConfig & { key: string })[]>,
  opts?: PostgresConnectionOpts<A>,
): ConnectionEntry<PgClient, Resolved<A>>;
export function postgresConnection<A extends StandardSchemaLike = never>(
  input: ConnectionInput<PostgresConnectionConfig, Resolved<A>>,
  opts?: PostgresConnectionOpts<A>,
): ConnectionEntry<PgClient, Resolved<A>> {
  return connectionEntry<PostgresConnectionConfig, PgClient, Resolved<A>>(
    "postgres",
    input,
    { client: openPgClient, args: opts?.args },
  );
}
