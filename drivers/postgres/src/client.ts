// @schemic/postgres/client — the P1 ORM CLIENT: a disposable handle that BINDS a connection and exposes
// the typed query surface PRE-BOUND (no `.run(externalConn)` threading). Two ways to get one:
//   - MANAGED: `connect(name?)` resolves the connection from `schemic.config.ts` (the single source of
//     truth the CLI already uses) and OWNS it — dispose/close closes it.
//   - BYO: `connect(myPgConn)` wraps a connection you own — dispose/close is a NO-OP (we never close
//     a connection the user owns; the hard dispose rule).
// P1 is READS (`select`); writes (`create`/`update`/`delete`) are P2. Composes `./query`'s builder +
// `./driver`'s `connect`, so importing `/client` DOES pull the engine — it's a runtime ORM entry (like
// `/query`), NOT the side-effect-free authoring index.

import {
  asyncDisposable,
  type OrmClientBase,
  type ResolveConnectionOptions,
  resolveConnection,
} from "@schemic/core";
import type { App, PgTableDef } from "./authoring";
import type { PgConn } from "./connection";
import { postgresDriver } from "./driver";
import { type SelectQuery, select } from "./query";

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
  select<TD extends PgTableDef>(table: TD): SelectQuery<TD, App<TD>> {
    return select(table, this.conn);
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
/** Open the connection named in `schemic.config.ts` (default connection if omitted) — the client OWNS it. */
export function connect(name?: string): Promise<PgClient>;
/** Open a resolved connection with explicit options (config path, keyed-collection key, resolver args). */
export function connect(opts: ResolveConnectionOptions): Promise<PgClient>;
export function connect(
  arg?: PgConn | string | ResolveConnectionOptions,
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
  const opts: ResolveConnectionOptions =
    typeof arg === "string"
      ? { name: arg }
      : ((arg as ResolveConnectionOptions | undefined) ?? {});
  return resolveConnection(opts).then((config) =>
    postgresDriver.connect(config).then((conn) => PgClient.managed(conn)),
  );
}
