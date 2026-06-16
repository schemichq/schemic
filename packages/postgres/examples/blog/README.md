# Schemic + PostgreSQL — blog example

A minimal, working [Schemic](https://github.com/schemichq/schemic) project for **PostgreSQL**: a
connections-only config, a schema authored in **pg-native `s.*`**, and the standard CLI workflow.
It doubles as a smoke-test of `@schemic/postgres` (the `postgresConnection` factory + the authoring
surface + the connections-only config).

## Layout

```
schemic.config.ts        # connections-only config — one `default` postgresConnection
schema/tables.ts         # the schema, authored in pg-native s.* (lowers to the portable IR)
database/migrations/     # generated migration files + the snapshot (created by `schemic gen`)
```

## Setup

```sh
# Install the CLI, the Postgres driver, and the embedded engine.
bun add -D @schemic/cli @schemic/postgres @electric-sql/pglite
# (or: npm i -D … / pnpm add -D …)
```

The config uses **embedded PGlite** by default (`url: "file:./.pgdata"`, a local data dir) so the
example runs with no server. To target a real Postgres, set `DATABASE_URL`:

```sh
export DATABASE_URL=postgres://user:pass@localhost:5432/app   # (node-postgres client: coming soon)
```

## Workflow

```sh
schemic gen init      # diff the schema vs the snapshot, preview the DDL, write a migration
schemic migrate       # apply pending migrations (records them in _migrations)
schemic status        # show applied vs pending migrations
schemic diff          # show how the schema differs from the live database
```

`gen` is idempotent — once generated and applied, a re-run reports "No schema changes."

## The schema (pg-native `s.*`)

`schema/tables.ts` shows the Postgres vocabulary and `$`-clauses:

```ts
import { defineTable, s, sqlExpr } from "@schemic/postgres";

export const author = defineTable("author", {
  email: s.varchar(255).$unique(),               // varchar(n) + UNIQUE index
  name: s.text(),
  bio: s.text().optional(),                       // nullable column
  createdAt: s.timestamptz().$default(sqlExpr("now()")),
});

export const post = defineTable("post", {
  title: s.varchar(200),
  body: s.text(),
  views: s.integer().$default(0).$check("views >= 0"),  // DEFAULT + CHECK
  rating: s.numeric(3, 2).optional(),                    // numeric(p, s)
  meta: s.jsonb(),
  author: author.record({ onDelete: "cascade" }),        // FK with ON DELETE
  publishedAt: s.timestamptz().optional(),
});

export const postTag = defineTable("post_tag", {
  post: post.record({ onDelete: "cascade" }),
  tag: tag.record({ onDelete: "cascade" }),
}).primaryKey("post", "tag");                      // composite PRIMARY KEY (no implicit id)
```

Every field IS a Zod schema (App-side typing) — `s.*` layers pg-native DDL metadata on top via the
`$`-methods. Types Postgres has no portable equivalent for are exact (`varchar(255)`, `numeric(3,2)`,
`bigint`, …); the canonical ones (`text`, `integer`, `timestamptz`, …) map to portable types so the
schema can also target other Schemic drivers.

> Tip: `schemic init --driver postgres` scaffolds a fresh project just like this one.
