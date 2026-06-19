# @schemic/postgres

The PostgreSQL driver for [Schemic](https://github.com/schemichq/schemic) —
author your Postgres schema in TypeScript and emit, introspect, and diff it as
native SQL DDL.

> [!NOTE]
> **Alpha.** Today the driver runs on embedded [PGlite](https://pglite.dev):
> authoring, DDL emit, introspection, and migrations round-trip against it. A
> client for hosted Postgres servers is planned. See
> [docs/COVERAGE.md](docs/COVERAGE.md) for the feature-by-feature status.

## Install

```bash
bun add @schemic/cli @schemic/postgres @electric-sql/pglite
```

`@electric-sql/pglite` is the embedded engine (the only engine today). `zod`
ships with the driver — add it yourself only if you import `z` directly for
custom codecs.

## Quick start

Scaffold a Postgres project (`sc` is the short alias for `schemic`):

```bash
sc init --driver postgres
```

`init` writes a `schemic.config.ts`, a sample schema, a seed stub, and
`.env.example`. The sample schema:

```ts
// database/schema/tables.ts
import { defineTable, s, sqlExpr } from "@schemic/postgres";

export const user = defineTable("user", {
  email: s.varchar(255).$unique(),
  name: s.text(),
  age: s.smallint().optional(),
  createdAt: s.timestamptz().$default(sqlExpr("now()")),
});
```

…which emits this Postgres DDL (an `id` primary key is added automatically):

```sql
CREATE TABLE "user" (
  "id" text PRIMARY KEY,
  "age" smallint,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "email" varchar(255) NOT NULL,
  "name" text NOT NULL
);
CREATE UNIQUE INDEX "user_email_key" ON "user" ("email");
```

The connection lives in `schemic.config.ts` — a named connection from the
`postgresConnection` factory (no `driver:` string to keep in sync):

```ts
import { defineConfig } from "@schemic/core/config";
import { postgresConnection } from "@schemic/postgres";

export default defineConfig({
  connections: {
    default: postgresConnection({
      schema: "./database/schema",
      // PGlite (embedded): `file:<dir>` persists to a data dir; "" is in-memory.
      url: process.env.DATABASE_URL ?? "file:./.pgdata",
    }),
  },
});
```

Then drive it from the CLI:

```bash
sc diff        # preview changes vs the last snapshot
sc gen         # write a migration for the pending change
sc migrate     # apply pending migrations
sc seed        # run database/seed.ts against a connection
sc status      # show applied vs pending migrations
```

## Authoring

`s.*` is a [Zod](https://zod.dev) superset with Postgres-native types —
`s.varchar(n)`, `s.text()`, `s.smallint()`, `s.timestamptz()`, and more — plus
DDL modifiers like `.$unique()` and `.$default(sqlExpr(...))`. Reach for
`sqlExpr` to drop raw SQL into defaults and other expressions.

## Docs

Feature-by-feature coverage: [docs/COVERAGE.md](docs/COVERAGE.md). This package
is part of the [Schemic](https://github.com/schemichq/schemic) toolkit — shared
concepts (schema-as-code, the migration model, codecs) are at
[schemic.dev](https://schemic.dev).

## License

[MIT](./LICENSE) © Vertio Solutions
