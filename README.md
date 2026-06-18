# Schemic

> Driver-based, schema-as-code for your database — author your schema in TypeScript,
> generate the target dialect's DDL, and manage migrations, across databases.

Schemic lets you define your database schema once in TypeScript and drive it to the
database of your choice through installed **driver packages**: generate native DDL,
diff against a snapshot or a live database, and run migrations — all dialect-aware.
The authoring API (`s.*`) is a **Zod superset**, so the schema you write is also the
validator you already know.

## Packages

| Package | What it is |
| --- | --- |
| [`@schemic/core`](packages/core) | The dialect-neutral engine: the `Driver` contract, the portable schema IR, and the migration / diff / snapshot engine. Zero dialect code. |
| [`@schemic/cli`](packages/cli) | The `schemic` / `sc` binary — also dialect-neutral; it loads your driver dynamically from `config.driver`. |
| [`@schemic/surrealdb`](packages/surrealdb) | The SurrealDB driver: connection + `s.*` authoring + SurrealQL DDL. |
| [`@schemic/postgres`](packages/postgres) | The PostgreSQL driver: connection + authoring + SQL DDL. |

## Quick start

```bash
bun add @schemic/cli @schemic/surrealdb
```

Author a table — the driver's `s.*` builders are Zod drop-ins:

```ts
// schema/account.ts
import { defineTable, s } from "@schemic/surrealdb";

export const account = defineTable("account", {
  id: s.string(),
  name: s.string(),
});
```

…which Schemic emits as native DDL:

```surql
DEFINE TABLE account TYPE NORMAL SCHEMAFULL;
DEFINE FIELD name ON TABLE account TYPE string;
```

Then drive it from the CLI (`sc` is the short alias):

```bash
sc init        # scaffold a project: schemic.config.ts + schema + .env.example
sc diff        # preview changes vs the last snapshot   (--ts for a TypeScript-side view)
sc gen         # write a migration for the pending change
sc migrate     # apply pending migrations
sc status      # show applied vs pending migrations
sc pull        # introspect a live database back into TypeScript
```

## Authoring

`s.*` is a **superset of Zod** — every `z.*` builder works, plus the driver's native
types and a `.$<driver>(wire, codec?)` escape hatch for app types with no native
mapping (e.g. `s.custom<URL>().$surreal(s.string(), { encode, decode })`). Each driver
ships a verified example cookbook under its `examples/` — authoring paired with the
exact DDL it emits, asserted by tests so the examples can never drift.

## Status

**Alpha (`0.x`).** APIs may still change. SurrealDB is the most complete driver;
PostgreSQL is in progress. See each driver's `docs/COVERAGE.md` for a feature-by-feature map.

## Development

A [Bun](https://bun.com) workspaces monorepo (`packages/*`).

```bash
bun install
bun --filter '@schemic/*' test       # run every package's tests
bun --filter '@schemic/*' typecheck
```

## License

[MIT](LICENSE) © Vertio Solutions
