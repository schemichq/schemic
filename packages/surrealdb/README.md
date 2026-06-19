# @schemic/surrealdb

The SurrealDB driver for [Schemic](https://github.com/schemichq/schemic) — author
your SurrealDB schema in TypeScript and generate SurrealQL DDL, types, and
migrations from that one definition.

- Define tables and relations with `s.*`, a drop-in for [Zod](https://zod.dev)'s `z.*`.
- Generate `DEFINE TABLE` / `DEFINE FIELD` DDL, run reviewable migrations, and introspect a live database back into TypeScript.
- Read and write rows as typed values via codecs (`datetime` ⇄ `Date`, `uuid`, record links, …).

## Install

```bash
bun add @schemic/cli @schemic/surrealdb zod
```

`zod` is a required peer. `@surrealdb/node` is an optional peer (the embedded
in-memory engine `schemic check` can replay into). The `surrealdb` SDK ships with
the driver — you only import it directly in seed or app query code.

## Quick start

Scaffold a project (`sc` is the short alias for `schemic`):

```bash
sc init
```

`init` writes a `schemic.config.ts`, a sample `user` schema, a seed stub, and
`.env.example`. The sample schema:

```ts
// database/schema/tables/user.ts
import { defineTable, s, surql } from "@schemic/surrealdb";

export const User = defineTable("user", {
  name: s.string().$assert(surql`string::len($value) > 0`),
  email: s.email().unique(),
  createdAt: s.datetime().$default(surql`time::now()`).$readonly(),
}).schemafull();
```

…which generates this SurrealQL DDL (the `id` field is provided automatically):

```surql
DEFINE TABLE user TYPE NORMAL SCHEMAFULL;
DEFINE FIELD name ON TABLE user TYPE string ASSERT string::len($value) > 0;
DEFINE FIELD email ON TABLE user TYPE string ASSERT string::is_email($value);
DEFINE INDEX user_email_idx ON TABLE user FIELDS email UNIQUE;
DEFINE FIELD createdAt ON TABLE user TYPE datetime DEFAULT time::now() READONLY;
```

The connection lives in `schemic.config.ts` — a named connection from the
`surrealConnection` factory (no `driver:` string to keep in sync):

```ts
import { defineConfig } from "@schemic/core/config";
import { surrealConnection } from "@schemic/surrealdb";

export default defineConfig({
  connections: {
    default: surrealConnection({
      schema: "./database/schema",
      url: process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc",
      namespace: process.env.SURREAL_NAMESPACE ?? "app",
      database: process.env.SURREAL_DATABASE ?? "app",
      username: process.env.SURREAL_USER,
      password: process.env.SURREAL_PASS,
      authLevel: "root", // "root" | "namespace" | "database"
    }),
  },
});
```

Then drive it from the CLI:

```bash
sc diff        # preview changes vs the last snapshot   (--ts for a TypeScript view)
sc gen         # write a migration for the pending change
sc migrate     # apply pending migrations
sc seed        # run database/seed.ts against a connection
sc status      # show applied vs pending migrations
sc pull        # introspect a live database back into TypeScript
```

## Reading & writing rows

A table definition carries codecs that bridge your app values and the database
wire format. `decode` turns a returned row into typed values (a `datetime`
becomes a `Date`, a `uuid` a string, record links resolve); `encode` and
`encodePartial` build the payloads you write back. You keep the `surrealdb` SDK
for queries — Schemic owns the schema, DDL, migrations, and row types.

## Docs

Full guides, concepts, and reference live at
[surreal.schemic.dev/docs](https://surreal.schemic.dev/docs). For a
feature-by-feature map, see [docs/COVERAGE.md](docs/COVERAGE.md). This package is
part of the [Schemic](https://github.com/schemichq/schemic) toolkit.

## License

[MIT](./LICENSE) © Vertio Solutions
