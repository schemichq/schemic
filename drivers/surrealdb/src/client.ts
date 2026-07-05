// The bound ORM CLIENT for SurrealDB (`@schemic/surrealdb/client`): connection-bound reads (P1,
// `select`) + writes (P2, split builders `create`/`update`/`delete`) — no `.run(externalDb)` — over a
// Schemic-MANAGED (resolved from the project config) or a BYO (wrap-your-own) SurrealDB connection.
// Built on core's neutral OrmClientBase (disposable lifecycle). See @schemic/core
// docs/proposals/managed-connections-and-orm-client.md.

import {
  asyncDisposable,
  type OrmClientBase,
  type ResolvedConfig,
  resolveConnection,
} from "@schemic/core";
import { type BoundQuery, Surreal, type SurrealSession } from "surrealdb";
import { surrealDriver } from "./driver";
import type {
  App,
  CallArgsIn,
  CallQuery,
  FunctionDef,
  Shape,
  TableDef,
} from "./pure";
import {
  type CreateQuery,
  create,
  type DeleteQuery,
  get,
  type Queryable,
  remove,
  type Select,
  type SelectOne,
  select,
  type TargetId,
  type UpdateQuery,
  update,
} from "./query";

// biome-ignore lint/suspicious/noExplicitAny: TableDef's Shape varies per call site.
type AnyTable = TableDef<string, any>;

/** Something ONE statement result can be decoded through in {@link RawQuery.as}: a rows schema
 *  (`User.object.array()` — Zod's parse runs the codec decode channel), a table (its `decode`,
 *  for single-row statements like `FROM ONLY`), or any Standard-Schema / Zod schema (its `parse`
 *  — e.g. `z.number()` for a `RETURN`). */
interface Decoder<T = unknown> {
  decode?(value: unknown): T;
  parse?(value: unknown): T;
}
/** A decoder's output type — reads `decode` first (the codec channel), then `parse`. */
type DecodeOut<D> = D extends { decode(value: unknown): infer T }
  ? T
  : D extends { parse(value: unknown): infer T }
    ? T
    : unknown;

/**
 * A raw SurrealQL query bound to a connection — the escape hatch for anything the typed builders don't
 * cover. Awaiting it is SDK-FAITHFUL: it resolves the PER-STATEMENT result array (one entry per
 * statement, exactly what the SDK's `query()` returns — nothing is dropped). A typed `surql<[...]>`
 * tag flows through: `db.query(surql<[number]>\`RETURN 1\`)` resolves `[number]`; for a plain string,
 * type it explicitly — `db.query<[User[]]>("SELECT * FROM user")`. `.as(schema)` is the
 * single-statement SELECT sugar: the sole statement's rows, each decoded.
 */
export class RawQuery<R extends unknown[] = unknown[]>
  implements PromiseLike<R>
{
  constructor(
    private readonly conn: Queryable,
    private readonly sql: string | BoundQuery,
    private readonly params?: Record<string, unknown>,
  ) {}

  private async results(): Promise<unknown[]> {
    return (
      typeof this.sql === "string"
        ? await this.conn.query(this.sql, this.params)
        : await this.conn.query(this.sql)
    ) as unknown[];
  }

  /** Await -> the per-statement result array (undecoded, SDK-faithful). */
  then<R1 = R, R2 = never>(
    onfulfilled?: ((value: R) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.results()
      .then((r) => r as R)
      .then(onfulfilled, onrejected);
  }

  /** Decode the per-statement results through a TUPLE of decoders — one per statement, mirroring
   *  the result shape: `db.query("RETURN 1; SELECT …").as([z.number(), User.object.array()])`
   *  resolves `[number, Row[]]`. Rows decode via `Table.object.array()` (a real ZodArray whose
   *  `parse` runs the codec channel); scalars via any Standard-Schema/Zod schema; a single-row
   *  statement (`FROM ONLY`) via the table itself. Throws a teaching error when the decoder count
   *  doesn't match the statement count. */
  as<const Ds extends readonly Decoder[]>(
    decoders: Ds,
  ): Promise<{ -readonly [K in keyof Ds]: DecodeOut<Ds[K]> }> {
    const apply = (d: Decoder, value: unknown): unknown =>
      typeof d.decode === "function"
        ? d.decode(value)
        : typeof d.parse === "function"
          ? d.parse(value)
          : value;
    return this.results().then((out) => {
      if (out.length !== decoders.length)
        throw new Error(
          `.as([...]) got ${decoders.length} decoder(s) for ${out.length} statement result(s) — provide exactly one decoder per statement.`,
        );
      return out.map((v, i) => apply(decoders[i] as Decoder, v)) as {
        -readonly [K in keyof Ds]: DecodeOut<Ds[K]>;
      };
    });
  }
}

/** Managed-connection options for {@link connect} (a subset of core's `resolveConnection`). */
export interface ConnectOptions {
  /** Path to `schemic.config.ts` (else auto-discovered from `cwd`). */
  config?: string;
  /** Working directory to discover the config from. */
  cwd?: string;
  /** The resolver's args (its declared 2nd param) for a PARAMETERIZED connection. Untyped here —
   *  for per-connection typed args use the config factory: `schemic.connect(name, args)`. */
  args?: unknown;
}

/**
 * The bound ORM client — a connection plus the driver's typed, pre-bound reads. `db.select(User)…` runs
 * against the bound connection (no `.run(db)`), and `await using db = await connect()` closes it at
 * block exit. DISPOSE RULE (hard): a MANAGED client closes the connection it opened; a BYO client's
 * `close()` is a NO-OP — we never close a connection the user owns.
 */
export class Client implements OrmClientBase {
  /** `[Symbol.asyncDispose]` = `close()`, installed on the prototype by {@link asyncDisposable} below
   *  (declared so `await using` sees it statically). */
  declare [Symbol.asyncDispose]: () => Promise<void>;

  constructor(
    /** The bound SurrealDB connection. */
    readonly conn: Surreal,
    private readonly managed: boolean,
  ) {}

  /** A connection-bound single-table SELECT — awaitable (`await db.select(User).where(…).limit(10)`). */
  select<TD extends AnyTable>(table: TD): Select<TD, App<TD>> {
    return select(table, this.conn);
  }

  /** Fetch ONE record by id — `await db.get(User, id)` resolves to the decoded row or `undefined`
   *  (the read half of id-chaining: `create` hands you an id, `get` fetches it back). */
  get<TD extends AnyTable>(table: TD, id: TargetId<TD>): SelectOne<App<TD>> {
    return get(table, id, this.conn);
  }

  /** A connection-bound CREATE — `await db.create(User).content({ … })` returns the created row
   *  (validated via `User.create`, encoded through the codec). */
  create<TD extends AnyTable>(table: TD): CreateQuery<TD, App<TD>> {
    return create(table, this.conn);
  }

  /** A connection-bound single-record UPDATE — `await db.update(User, id).merge({ … })` (deep merge,
   *  via `User.update`) / `.content(row)` (replace) / `.set(patch)`. Returns the updated row. */
  update<TD extends AnyTable>(
    table: TD,
    id: TargetId<TD>,
  ): UpdateQuery<TD, App<TD>> {
    return update(table, id, this.conn);
  }

  /** A connection-bound single-record DELETE — `await db.delete(User, id)`; `.return("before")`
   *  hands back the deleted row. */
  delete<TD extends AnyTable>(
    table: TD,
    id: TargetId<TD>,
  ): DeleteQuery<TD, undefined> {
    return remove(table, id, this.conn);
  }

  /** A connection-bound function CALL — `await db.call(SendMail, { email, code })` runs
   *  `fn::send_mail(...)` and decodes via the def's `.returns(R)`. Args: literals (encoded+bound),
   *  fragments, or `surql.$` refs. */
  call<A extends Shape, R>(
    def: FunctionDef<A, R>,
    ...rest: Record<string, never> extends CallArgsIn<A>
      ? [args?: CallArgsIn<A>]
      : [args: CallArgsIn<A>]
  ): CallQuery<R> {
    return def.call(...(rest as [CallArgsIn<A>])).bind(this.conn);
  }

  /** Raw SurrealQL escape hatch — SDK-faithful: `await db.query(…)` -> the PER-STATEMENT result
   *  array. A typed tag flows through (`db.query(surql<[number]>\`RETURN 1\`)` -> `[number]`); type
   *  a plain string explicitly (`db.query<[User[]]>("SELECT …")`). `.as(User)` decodes a
   *  single-statement SELECT's rows. */
  query<R extends unknown[]>(sql: BoundQuery<R>): RawQuery<R>;
  query<R extends unknown[] = unknown[]>(
    sql: string,
    params?: Record<string, unknown>,
  ): RawQuery<R>;
  query(sql: string | BoundQuery, params?: Record<string, unknown>): RawQuery {
    return new RawQuery(this.conn, sql, params);
  }

  /** Fork a scoped, disposable {@link Session} (its own auth/session context) with the same bound
   *  reads + writes — `await using s = await db.forkSession()` releases the fork on exit. */
  async forkSession(): Promise<Session> {
    return new Session(await this.conn.forkSession());
  }

  /** Close the connection — MANAGED only; a BYO client is a NO-OP (never close the user's connection). */
  async close(): Promise<void> {
    if (this.managed) await surrealDriver.close(this.conn);
  }
}
asyncDisposable(Client.prototype);

/**
 * A forked, disposable SurrealDB session — the same bound reads over a derived auth/session context.
 * `close()` disposes the fork (never the parent connection).
 */
export class Session implements OrmClientBase {
  declare [Symbol.asyncDispose]: () => Promise<void>;

  constructor(
    /** The underlying forked session. */
    readonly session: SurrealSession,
  ) {}

  /** A session-bound single-table SELECT (awaitable). */
  select<TD extends AnyTable>(table: TD): Select<TD, App<TD>> {
    return select(table, this.session);
  }

  /** Fetch ONE record by id, scoped to this session. */
  get<TD extends AnyTable>(table: TD, id: TargetId<TD>): SelectOne<App<TD>> {
    return get(table, id, this.session);
  }

  /** A session-bound CREATE (runs under this session's auth context). */
  create<TD extends AnyTable>(table: TD): CreateQuery<TD, App<TD>> {
    return create(table, this.session);
  }

  /** A session-bound single-record UPDATE. */
  update<TD extends AnyTable>(
    table: TD,
    id: TargetId<TD>,
  ): UpdateQuery<TD, App<TD>> {
    return update(table, id, this.session);
  }

  /** A session-bound single-record DELETE. */
  delete<TD extends AnyTable>(
    table: TD,
    id: TargetId<TD>,
  ): DeleteQuery<TD, undefined> {
    return remove(table, id, this.session);
  }

  /** A session-bound function CALL (runs under this session's auth context). */
  call<A extends Shape, R>(
    def: FunctionDef<A, R>,
    ...rest: Record<string, never> extends CallArgsIn<A>
      ? [args?: CallArgsIn<A>]
      : [args: CallArgsIn<A>]
  ): CallQuery<R> {
    return def.call(...(rest as [CallArgsIn<A>])).bind(this.session);
  }

  /** Raw SurrealQL escape hatch, scoped to this session (SDK-faithful per-statement results). */
  query<R extends unknown[]>(sql: BoundQuery<R>): RawQuery<R>;
  query<R extends unknown[] = unknown[]>(
    sql: string,
    params?: Record<string, unknown>,
  ): RawQuery<R>;
  query(sql: string | BoundQuery, params?: Record<string, unknown>): RawQuery {
    return new RawQuery(this.session, sql, params);
  }

  /** Close (dispose) the forked session — leaves the parent connection open. */
  async close(): Promise<void> {
    await this.session.closeSession();
  }
}
asyncDisposable(Session.prototype);

/**
 * Get a bound ORM client. **BYO** — wrap an existing connection (its `close()` is a no-op):
 * `const db = connect(mySurreal)`. **MANAGED** — resolve + connect from the project config (the single
 * source of truth), owning the connection: `await using db = await connect()` / `connect("reporting")`
 * / `connect("tenant", { args: { region: "eu", org: "acme" } })`.
 */
export function connect(client: Surreal): Client;
export function connect(name?: string, opts?: ConnectOptions): Promise<Client>;
export function connect(
  nameOrClient?: string | Surreal,
  opts: ConnectOptions = {},
): Client | Promise<Client> {
  // BYO: wrap an existing client — never opens or closes a connection.
  if (nameOrClient instanceof Surreal) return new Client(nameOrClient, false);
  // MANAGED: resolve the named connection from the config, then open it (we own + close it).
  return (async () => {
    const config = await resolveConnection({ name: nameOrClient, ...opts });
    return connectFromConfig(config);
  })();
}

/**
 * Open a MANAGED client from an already-{@link ResolvedConfig | resolved} config (no re-resolution) —
 * the opener the `surrealConnection` factory embeds so `defineConfig(...).connect(name)` can hand back a
 * typed, owned `Client`. Lazy-imported by the connection factory to keep the engine out of config-authoring.
 */
export async function connectFromConfig(
  config: ResolvedConfig,
): Promise<Client> {
  const conn = await surrealDriver.connect(config);
  return new Client(conn, true);
}
