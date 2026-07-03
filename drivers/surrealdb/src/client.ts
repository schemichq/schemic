// The bound ORM CLIENT for SurrealDB (`@schemic/surrealdb/client`). P1 = reads: a connection-bound
// `select` — no `.run(externalDb)` — over a Schemic-MANAGED (resolved from the project config) or a
// BYO (wrap-your-own) SurrealDB connection. Built on core's neutral OrmClientBase (disposable
// lifecycle). Writes are P2. See @schemic/core docs/proposals/managed-connections-and-orm-client.md.

import {
  asyncDisposable,
  type OrmClientBase,
  resolveConnection,
} from "@schemic/core";
import { Surreal, type SurrealSession } from "surrealdb";
import { surrealDriver } from "./driver";
import type { App, TableDef } from "./pure";
import { type Select, select } from "./query";

// biome-ignore lint/suspicious/noExplicitAny: TableDef's Shape varies per call site.
type AnyTable = TableDef<string, any>;

/** Managed-connection options for {@link connect} (a subset of core's `resolveConnection`). */
export interface ConnectOptions {
  /** Address one element of a keyed collection (`<name>:<key>`). */
  key?: string;
  /** Path to `schemic.config.ts` (else auto-discovered from `cwd`). */
  config?: string;
  /** Working directory to discover the config from. */
  cwd?: string;
  /** `--arg`-style values handed to a resolver connection. */
  args?: Record<string, string>;
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

  /** Fork a scoped, disposable {@link Session} (its own auth/session context) with the same bound
   *  reads — `await using s = await db.forkSession()` releases the fork on exit. */
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
 * / `connect("tenant", { key })`.
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
    const conn = await surrealDriver.connect(config);
    return new Client(conn, true);
  })();
}
