// @schemic/postgres/client — the P1 ORM CLIENT: a disposable handle that BINDS a connection and exposes
// the typed query surface PRE-BOUND (no `.run(externalConn)` threading). Two ways to get one:
//   - MANAGED: `connect(name?)` resolves the connection from `schemic.config.ts` (the single source of
//     truth the CLI already uses) and OWNS it — dispose/close closes it.
//   - BYO: `connect(myPgConn)` wraps a connection you own — dispose/close is a NO-OP (we never close
//     a connection the user owns; the hard dispose rule).
// Surface: READS (`select`) + WRITES (`create`/`update`/`delete`). Composes `./query`'s builder +
// `./driver`'s `connect`, so importing `/client` DOES pull the engine — it's a runtime ORM entry (like
// `/query`), NOT the side-effect-free authoring index.

import {
  asyncDisposable,
  type OrmClientBase,
  type ResolveConnectionOptions,
  type ResolvedConfig,
  resolveConnection,
  type StandardSchemaLike,
} from "@schemic/core";
import { type App, PgTableDef } from "./authoring";
import type { PgConn } from "./connection";
import { postgresDriver } from "./driver";
import {
  type CreateBuilder,
  create,
  type DeleteQuery,
  get,
  type IdOf,
  type PgSelectOne,
  type RowOf,
  remove,
  type SelectQuery,
  select,
  type UpdateBuilder,
  update,
} from "./query";

/** The output type a Standard-Schema decodes to (Zod/valibot/etc. carry `~standard.types.output`). */
type StandardOut<S> = S extends {
  "~standard": { types?: { output?: infer O } };
}
  ? O
  : unknown;

/**
 * A RAW SQL query bound to a connection (from `db.query(...)`): raw wire rows by DEFAULT; `.as(schema)`
 * decodes each row through a Standard-Schema (or a table -> its `.object`). Thenable — runs on `await`.
 */
export class RawQuery<Res> implements PromiseLike<Res[]> {
  constructor(
    private readonly conn: PgConn,
    private readonly sql: string,
    private readonly params: unknown[],
    private readonly schema?: StandardSchemaLike,
  ) {}
  /** Decode each row through a table's row codec (`db.query(...).as(User)`). */
  as<T extends PgTableDef>(table: T): RawQuery<App<T>>;
  /** Decode each row through any Standard-Schema (`User.object.pick(...)`, a `z.*`, …). */
  as<S extends StandardSchemaLike>(schema: S): RawQuery<StandardOut<S>>;
  as(schemaOrTable: StandardSchemaLike | PgTableDef): RawQuery<unknown> {
    const schema =
      schemaOrTable instanceof PgTableDef
        ? (schemaOrTable.object as unknown as StandardSchemaLike)
        : schemaOrTable;
    return new RawQuery(this.conn, this.sql, this.params, schema);
  }
  /** Render `{ sql, params }` (the query is already lowered — this is just what will run). */
  toSQL(): { sql: string; params: unknown[] } {
    return { sql: this.sql, params: this.params };
  }
  /** Execute + (if `.as(...)`) decode each row. */
  async run(): Promise<Res[]> {
    const { rows } = await this.conn.query(this.sql, this.params);
    const s = this.schema;
    if (!s) return rows as Res[];
    return rows.map((row) => {
      const r = s["~standard"].validate(row);
      if (r instanceof Promise)
        throw new Error(
          "db.query(...).as(schema): async schemas are not supported.",
        );
      if ("issues" in r)
        throw new Error(
          `db.query(...).as(schema): decode failed — ${r.issues.map((i) => i.message).join("; ")}`,
        );
      return r.value as Res;
    });
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional — a raw query is awaitable (mirrors the select builder)
  then<R1 = Res[], R2 = never>(
    onFulfilled?: ((value: Res[]) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onFulfilled, onRejected);
  }
}

/**
 * The bound Postgres ORM client. `db.select(table)` runs against THIS client's connection.
 * `AsyncDisposable`: `await using db = await connect()` closes a managed client at block exit. Construct
 * via {@link connect}; the constructor is private so the managed/BYO dispose rule can't be bypassed.
 */
export class PgClient implements OrmClientBase {
  private constructor(
    /** The bound connection (managed or BYO). */
    readonly conn: PgConn,
    private readonly managed: boolean,
  ) {}
  /** @internal — a managed client that OWNS the connection (close closes it). */
  static managed(conn: PgConn): PgClient {
    return new PgClient(conn, true);
  }
  /** @internal — a BYO client that BORROWS the connection (close is a no-op). */
  static byo(conn: PgConn): PgClient {
    return new PgClient(conn, false);
  }

  /**
   * A typed single-table read, pre-bound to this client's connection — the same `./query` builder, but
   * awaitable: `await db.select(user).where(u => u.age.gt(18))` runs and returns the decoded rows.
   */
  select<TD extends PgTableDef>(table: TD): SelectQuery<TD, RowOf<TD>> {
    return select(table, this.conn);
  }

  /**
   * Fetch ONE record by id, pre-bound: `await db.get(User, id)` — resolves the decoded row or
   * `undefined`. The read half of id-chaining (`db.create` hands you an id, `db.get` fetches it back).
   */
  get<TD extends PgTableDef>(table: TD, id: IdOf<TD>): PgSelectOne<RowOf<TD>> {
    return get(table, id, this.conn);
  }

  /**
   * INSERT one record, pre-bound to this client: `await db.create(User).content({ … })`. The payload
   * validates vs `User.create` at the `.content(...)` call (fail-fast); resolves the created row.
   */
  create<TD extends PgTableDef>(table: TD): CreateBuilder<TD> {
    return create(table, this.conn);
  }

  /**
   * UPDATE one record by id, pre-bound: `await db.update(User, id).merge({ … })` (partial) / `.content(row)`
   * (replace) / `.set({ … })`. The patch validates vs `User.update` / `User.create` at the call (fail-fast).
   */
  update<TD extends PgTableDef>(table: TD, id: IdOf<TD>): UpdateBuilder<TD> {
    return update(table, id, this.conn);
  }

  /**
   * DELETE one record by id, pre-bound: `await db.delete(User, id)` — resolves the deleted row (the client
   * method is `delete`; the standalone export is `remove`, since `delete` is a reserved word).
   */
  delete<TD extends PgTableDef>(
    table: TD,
    id: IdOf<TD>,
  ): DeleteQuery<TD, RowOf<TD> | undefined> {
    return remove(table, id, this.conn);
  }

  /**
   * A RAW SQL escape hatch bound to this client — `db.query("SELECT …", [p])`. Thenable (runs on
   * `await`); returns raw wire rows by DEFAULT (no decode, since the statement is arbitrary). Opt into
   * decoding with `.as(schema)`, piping each row through ANY Standard-Schema — a table's `.object`,
   * `User.object.pick({...})`, `User.create`, a composed `z.*`, etc. Replaces reaching into `db.conn`.
   */
  query(
    sql: string,
    params: unknown[] = [],
  ): RawQuery<Record<string, unknown>> {
    return new RawQuery(this.conn, sql, params);
  }

  /** Close the connection — MANAGED only; a BYO client is a no-op (never close a connection the user owns). */
  async close(): Promise<void> {
    if (this.managed) await this.conn.close();
  }
  declare [Symbol.asyncDispose]: () => Promise<void>;
}
asyncDisposable(PgClient.prototype);

/** Wrap an existing Postgres connection you own — dispose/close is a NO-OP (BYO). */
export function connect(conn: PgConn): PgClient;
/** Open the connection named in `schemic.config.ts` (default connection if omitted) — the client OWNS it.
 * For a PARAMETERIZED/bulk connection, pass the resolver's `args` to select exactly one config. */
export function connect(name?: string, args?: unknown): Promise<PgClient>;
/** Open a resolved connection with explicit options (config path, cwd, resolver args). */
export function connect(opts: ResolveConnectionOptions): Promise<PgClient>;
export function connect(
  arg?: PgConn | string | ResolveConnectionOptions,
  args?: unknown,
): PgClient | Promise<PgClient> {
  // BYO: an already-built connection (duck-typed — has `query` + `close`).
  if (
    arg &&
    typeof arg === "object" &&
    typeof (arg as PgConn).query === "function" &&
    typeof (arg as PgConn).close === "function"
  ) {
    return PgClient.byo(arg as PgConn);
  }
  // MANAGED: resolve from config -> driver.connect -> owned client. (The BYO PgConn is handled above,
  // so a remaining object here is ResolveConnectionOptions — the structural check isn't a type guard.)
  // A `name` string carries its resolver `args` through (parameterized/bulk selection).
  const opts: ResolveConnectionOptions =
    typeof arg === "string"
      ? { name: arg, args }
      : ((arg as ResolveConnectionOptions | undefined) ?? {});
  return resolveConnection(opts).then((config) =>
    postgresDriver.connect(config).then((conn) => PgClient.managed(conn)),
  );
}

/**
 * Open a MANAGED client from an ALREADY-resolved config — the `client` opener that
 * `postgresConnection(...)` embeds (lazily) so the typed `config.connect(name)` on `defineConfig` can
 * build a `PgClient` per connection. (The factory passes this via a lazy `import("./client")`, so a
 * config authored from `@schemic/postgres/connection` never statically pulls the engine.)
 */
export async function clientFromResolved(
  config: ResolvedConfig,
): Promise<PgClient> {
  return PgClient.managed(await postgresDriver.connect(config));
}
