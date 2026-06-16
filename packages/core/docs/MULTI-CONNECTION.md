# Multi-connection (one project, many databases)

> Status: **design** (not yet implemented). Lands in the **CLI/config layer** (`@schemic/cli`), on
> top of the driver-agnostic model — it adds no dialect code. Companion to `MULTI-DB-SPIKE.md`
> (which makes one connection target one driver) and the "CLI is as agnostic as core" principle.

## Goal

A single Schemic project addresses **multiple database connections**, covering three scenarios with
one model:

1. **N homogeneous DBs** — e.g. 3 SurrealDB instances sharing one schema (prod/staging/shard).
2. **Heterogeneous** — a SurrealDB *and* a Postgres (and/or libsql, …) in one project.
3. **DB-per-tenant / per-user** — one shared schema, a *dynamic* set of connections discovered at
   run time (often by querying a control DB).

## The keystone rule: *what* vs *where*

- A **schema** (a schema dir + its driver) is the **desired state**. It owns the **migration files +
  snapshot**. Authoring is driver-specific (`s.*` is exported by the driver package), so a schema is
  bound to a driver.
- A **connection** is a **physical database**. It owns the **applied-migrations state** (its own
  `_migrations` table).

So: **migration files/snapshot are per-schema; applied-state is per-connection.** `gen` runs once per
distinct schema (connection-agnostic); `migrate`/`status`/`diff --live` run per connection. Connections
that share a schema dir share its files+snapshot but each tracks its own applied set — which is exactly
tenant fan-out.

## Config model — per-driver connection factories

Each driver package exports a typed `<driver>Connection` factory; `defineConfig` accepts a neutral,
branded `ConnectionEntry` (the factory's output) and stays fully driver-agnostic. **This is chosen over a
discriminated-union `{ driver: "surrealdb", … }` config** (decided 2026-06-15): a factory's parameter is
*exactly* that driver's connection type, so inference + errors are precise — especially inside resolvers
and array returns, where union narrowing leaks; there's no module-augmentation footgun (a missing driver
import can't silently degrade `driver` to `string`); and **the import is the driver dependency**, consistent
with "the installed driver owns connection". The factory injects the driver tag, so the user never writes a
`driver: "…"` string.

```ts
import { surrealConnection } from "@schemic/surrealdb";
import { libsqlConnection } from "@schemic/libsql";

defineConfig({
  connections: {
    system: surrealConnection({ schema: "./system", url, namespace, database, authLevel: "root" }),
    //      └ param typed as the SURREAL connection — ns/authLevel checked; no driver string to desync

    // A resolver returning an ARRAY -> "tenants" is a COLLECTION (one connection per row).
    tenants: libsqlConnection(async ({ connections }) => {
      const users = await connections.system.query<{ id: string }>("SELECT id FROM users");
      return users.map((u) => ({
        key: u.id,                       // REQUIRED on array entries -> addressable `tenants:<id>`
        schema: "./tenants",             // ONE shared schema -> one set of migration files
        url: `libsql://tenant-${u.id}…`, // typed as the LIBSQL connection
      }));
    }),
  },
  defaultConnection: "system",           // bare-command target when >1 connection (see CLI addressing)
});
```

A single-DB project is sugar: today's `{ driver, db, schema }` ≡ one `surrealConnection({ schema, ...db })`
named `default`.

### The factory contract

```ts
// @schemic/core exports the neutral types; each driver exports a factory bound to ITS connection type `C`.

/** Opaque, branded output of any <driver>Connection(...) — the only thing defineConfig accepts. Never hand-authored. */
interface ConnectionEntry { /* internal { driver, resolve } */ }

interface ResolveContext {
  /** Lazy, queryable map of the OTHER connections — accessing one resolves+connects it on demand (a DAG). */
  connections: Record<string, { query<T = unknown>(sql: string, vars?: Record<string, unknown>): Promise<T[]> }>;
  /** CLI `--arg k=v` values, so a resolver can yield a SUBSET (one tenant) without resolving all. */
  args: Record<string, string>;
  env: NodeJS.ProcessEnv;
}

// e.g. @schemic/surrealdb ships these overloads (C = the surreal connection type, with ns/authLevel/…):
//   function surrealConnection(config: C): ConnectionEntry;                                       // single, static
//   function surrealConnection(resolve: (ctx: ResolveContext) => C | Promise<C>): ConnectionEntry; // single, dynamic
//   function surrealConnection(                                                                    // a COLLECTION
//     resolve: (ctx: ResolveContext) => (C & { key: string })[] | Promise<(C & { key: string })[]>,
//   ): ConnectionEntry;
// The array overload makes `key` MANDATORY in a collection and absent for a single connection — typed, explicit.
```

**Naming:** distinct `<driver>Connection` names (`surrealConnection` / `postgresConnection` /
`libsqlConnection`) so importing from two drivers at once (heterogeneous projects) never collides. A
namespaced `surreal.connection({…})` grouping the driver's surface (`surreal.s`, `surreal.connection`) is an
acceptable alternative.

**Mixed-driver collection** (some tenants surreal, some libsql in one group): return an array of *other
factory calls* — `[surrealConnection({ key, … }), libsqlConnection({ key, … })]` — via a core
`collection(resolve => ConnectionEntry[])` helper. Rare; composes without special-casing.

## Resolution — a lazy DAG

`ctx.connections.system` is a **lazy proxy**: the first access resolves `system`'s config, imports its
driver, connects, and memoizes the live handle for the run. So the dependency graph (`tenants` → `system`)
falls out of access order — no explicit declaration. Cycles are detected and error. A resolver may take
`ctx.args` to resolve a narrow subset (e.g. `--arg tenant=123` → resolve only that tenant's connection,
never touching the other 10k).

Raw reads in a resolver use a new **optional driver capability** `query(conn, sql, vars) → rows` (surreal/
postgres/libsql all have it; `seed` can use it too). It stays driver-agnostic — the resolver never names a
dialect.

## CLI addressing

| Command | Scope | Notes |
|---|---|---|
| `gen [--schema <dir> \| --connection <name>]` | per **schema** | **connection-agnostic** — diffs authored schema vs snapshot (both offline). No live DB; surreal canonicalization, if any, uses an **ephemeral throwaway** (`driver.shadow.ephemeral`), never a real connection. Default: every distinct schema; `--schema`/`--connection` scopes to one. |
| `migrate [--connection <name>[:<key>] \| --all] [--arg k=v]` | per **connection** | `tenants` = the whole collection; `tenants:123` = one; `--all` = every connection. |
| `status` / `diff --live` / `rollback` / `push` / `pull` / `seed` | per **connection** | need a target (see ambiguity rule below). |

**Ambiguity rule (target selection for live commands):**
- exactly **1** connection → it is the implicit target; no flag needed.
- **>1** + `defaultConnection` set → bare commands target it; `--connection <name>[:<key>]` / `--all` override.
- **>1** + `defaultConnection` NOT set → a bare live command **errors clearly**: *"multiple connections — pass
  `--connection <name>` or set `defaultConnection`."* Never guess which database you migrate. (`defaultConnection`
  must name a single static connection — a resolver/collection can't be the default.)

Each per-connection run is the existing single-connection pipeline pointed at one resolved connection: the
driver-agnostic orchestration loops connections → `getDriver(c.driver)` → `driver.connect(c)` → run, with
`MigrationStore` (already per-connection) tracking that DB's applied set. Fan-out is a loop; nothing in the
driver layer changes.

## Composition / boundaries

- **All of this is CLI/config-layer**, neutral. The connection registry, resolver evaluation, lazy proxy,
  collection keying, and fan-out live in `@schemic/cli`; each connection just names a driver. Consistent with
  "CLI is as agnostic as core."
- Driver-layer additions: only the optional `query` capability (for resolvers/seed). `connect`/`close`/`diff`/
  `apply`/`MigrationStore` already compose per-connection.

## Resolved decisions (2026-06-15)

- **Typesafety = per-driver factory functions** (`<driver>Connection(...)`), NOT a discriminated-union /
  module-augmentation config. See "Config model" — precise param typing, no augmentation footgun, import =
  driver dependency.
- **Collection addressing = `tenants:<key>`, with an EXPLICIT `key` required on every array entry** (enforced
  by the factory's array overload). No implicit derivation (the earlier `database ?? url` idea is dropped).
- **`gen` is connection-agnostic** (snapshot-vs-schema, offline); canonicalization uses an ephemeral throwaway,
  never a real connection — so "which connection does gen use" is moot.
- **`defaultConnection`** names a single static connection; the ambiguity rule (above) governs >1-connection
  target selection — bare live commands error when ambiguous rather than guessing.
- **Resolver caching:** lazy + memoized **per CLI invocation** (a resolver + its control-DB query runs once per
  run). Under `--watch`, the resolved set is **cached for the session** (schema-file saves don't change the
  tenant list); re-resolve only on an explicit trigger (refresh key, or `schemic.config.ts` changing).
  `--arg` resolves only the requested subset.

## Future complementary layer — multi-PROJECT workspace

Distinct from multi-*connection* (many connections, one config): a **workspace of independent projects** —
each subfolder its own `schemic.config.ts` (own schema + migrations + connection). Best for genuinely
independent schemas/services in a monorepo. The CLI discovers child configs and runs a command across them
(`schemic migrate --project api`, `--all-projects`). The two axes compose: *one config, many connections*
(shared-schema fan-out / coordinated) vs *many configs, one each* (independent). **Build multi-connection
first** (it covers the novel cases — tenants, heterogeneous fan-out); add the subfolder/workspace discovery
layer later as a thin wrapper.
