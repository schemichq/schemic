# Proposal: managed connections + the bound ORM client

**Status:** design proposal for alignment (core-dev). **Date:** 2026-07-02.
**Owner:** core-dev leads the neutral contract; each driver implements its bound client.
**Motivates:** turn the opt-in query layer into a cohesive ORM by giving it a *connection* — the one
piece missing so that `db.select(...)` / `db.create(...)` work against a Schemic-managed (or BYO)
connection, instead of the user hand-wiring a client and threading it through `.run(externalDb)`.
**Priority (per Manuel):** complement the ORM we are building (public, app-developer facing) FIRST;
Schemic Studio is a second consumer of the same layer.

## 1. Why now — what already exists, and the one gap

The pieces of an ORM are already built and independently shipped:

- **Query builder** — `select().where().orderBy().return()` + `defineFunction().call()` (`@schemic/<driver>/query` over `@schemic/core/query`).
- **Derived write schemas** — `TableDef.create` / `.update` (typed, Standard-Schema-composable) + `encode`/`decode` codecs (app ⇄ wire).
- **Connection config** — `schemic.config.ts` `connections` map, the `<driver>Connection(...)` factories, and the multi-connection **resolver engine** (keyed collections, `ctx.connections.<name>`, per-tenant / DB-per-user).

The **gap**: the query layer requires **bring-your-own client** — `select(User).run(db)`, where `db` is a
separately-constructed, separately-connected `new Surreal()` / pg client. So a user configures a
connection *once* in the config (for migrations) and then **re-declares it** to run a query. Two sources
of truth, out of sync, and no first-class runtime entry point. Connection management closes exactly this.

## 2. The proposed surface

### 2.1 Getting a client — two ways, both first-class
```ts
// (a) MANAGED — resolved + connected from the project's config (single source of truth)
const db = await connect();              // the default connection
const db = await connect("reporting");   // a named connection
const db = await connect("tenant", { key: "acme" }); // one element of a keyed collection

// (b) BYO — wrap an existing client / pool (drizzle model; NEVER forces a second pool)
const db = connect(myPgPool);            // or connect(mySurrealClient)
```
Managed `connect()` reuses the **same** resolver + `<driver>Connection` factories the CLI already uses,
so the config is the one place connection info lives. BYO stays a peer, not an afterthought — apps that
already own a pool keep using it.

### 2.2 The bound client — pre-bound, no `.run(externalDb)`
```ts
const rows   = await db.select(User).where(u => u.age.gt(18)).return(u => ({ name: u.name }));
const msg    = await db.call(greet, { name: "Ada" });
const record = await db.create(User, { name: "Ada", email: "ada@x.com" }); // uses User.create schema
await db.update(User, id, { name: "Ada L." });                            // uses User.update schema
await db.close();
```
`db` owns the connection; the query/write surface hangs off it. The existing `select()`/`.call()` are
reused verbatim — the client just binds the connection so `.run()` isn't threaded by hand.

## 3. Contract ownership (mirrors the query toolkit)

- **core** — a neutral `OrmClient` contract in `@schemic/core` (the shape of `connect`, the bound
  `select`/`call`/`create`/`update`/`close`), plus the managed-connect glue over the resolver engine.
  This is the same split as `@schemic/core/query` (neutral toolkit) ← `@schemic/<driver>/query` (impl).
- **drivers** — each implements its bound client over its native connection type (surreal `Surreal`,
  pg `PgConn`/pool), composing the core contract. Lives at `@schemic/<driver>/query` (or a new
  `@schemic/<driver>/client` subpath — see open Q).

## 4. Deliberate NON-goals (scope discipline)

- **We do NOT build a pool manager.** Pooling / reconnect / keep-alive is delegated to the native driver
  client (pg pool, PGlite, the Surreal SDK). Owning a Prisma-grade pool is the scope trap; we stay a thin
  bind over what the driver already does well.
- **We do NOT deprecate BYO-client.** `.run(client)` and `connect(client)` remain first-class so an app
  with its own pool never ends up with two.
- **Schema-as-code stays the identity.** The ORM/connection layer is a value-add on top of migrations +
  authoring, not a pivot to "Schemic is your runtime." Framing: *your schema config is also your
  connection config.*

## 5. Positioning (vs surqlize / other ORMs)

surqlize is the SurrealDB-only ORM; drizzle/prisma are single-dialect. Schemic's edge is **cross-driver
+ one source of truth**: the same `s.*` schema drives migrations, the query builder, runtime validation
(`create`/`update`), and now the connection — across SurrealDB *and* Postgres. That's the differentiator
worth building deliberately; it keeps us complementary to surqlize (a user can still drop to the native
client / surqlize for driver-specific power via BYO).

## 6. Phasing

- **P1 — bound client + connect.** Managed (`connect(name?)` from config) and BYO (`connect(client)`),
  wrapping the *existing* `select()`/`.call()` pre-bound (+ `close`). No new query features. Small,
  high-DX, proves the layer. Reuses the resolver engine as-is.
- **P2 — writes.** `create`/`update`/`delete`/(`upsert`?) on the client, using the derived `.create`/
  `.update` schemas + codecs.
- **P3 — Studio.** Studio instantiates the same client by connection name (multi-tenant via keyed
  collections). "Both" (app + Studio) falls out of one layer.

## 7. Open questions (for Manuel + drivers)

1. **Naming:** `connect()` vs `createClient()`; the handle `db` vs `orm` vs `client`. (Lean: `connect()` + `db`.)
2. **Client home:** extend `@schemic/<driver>/query`, or a new side-effectful `@schemic/<driver>/client`
   subpath (keeps `/query` composable + pure; connect pulls the connection factory, which is side-effectful).
3. **Sync vs async:** managed `connect()` is async (it connects); BYO `connect(client)` can be sync. OK to
   have both, or normalize to always-async for one signature?
4. **Transactions:** in P1/P2 scope, or deferred? (Lean: defer to a later phase — per-driver semantics
   differ a lot.)
5. **Lifecycle in Studio / long-lived apps:** reconnect + pool-health surfaced, or fully delegated to the
   native client with just `close()`? (Lean: delegate; expose `close()` only for P1.)
6. **Multi-connect ergonomics:** one `connect(name)` per connection, or a `connect()` that returns a
   map/proxy of all configured connections (like the resolver's `ctx.connections`)? (Lean: `connect(name)`
   per connection for P1; revisit a multi-handle if Studio wants it.)

## 8. Suggested next step

Ratify §2 (the surface) + the P1 scope + the open-question leans, then core-dev builds the P1 core
contract + managed-connect glue and hands each driver-dev its bound-client implementation (same handoff
as the query builder + `DriverCommand`).
