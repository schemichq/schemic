# Quickstart — `@schemic/surrealdb` + the schemic CLI

A minimal, runnable example of the **connections-only** config: a `schemic.config.ts` that wires the
[`surrealConnection`](../../src/connection.ts) factory to a SurrealDB, plus a small `user` / `post`
schema authored with `s.*` builders. It doubles as a smoke-test of the factory.

## Layout

```
quickstart/
├── schemic.config.ts     # connections: { default: surrealConnection({ … }) }
├── schema/
│   ├── user.ts           # schemafull `user` — unique email, assert, $default/$readonly
│   └── post.ts           # `post` — record<user> link, enum status, $value updatedAt
└── .env.example          # SURREAL_* values the config reads explicitly
```

The config maps named **connections**, each from a driver's `<driver>Connection(...)` factory — so the
driver is implied by the factory, never a `driver: "…"` string. Add more named connections for
multi-tenant / multi-DB projects; set `defaultConnection` to pick the bare-command target.

```ts
import { defineConfig } from "@schemic/core/config";
import { surrealConnection } from "@schemic/surrealdb";

export default defineConfig({
  connections: {
    default: surrealConnection({ schema: "./schema", url, namespace, database }),
  },
});
```

## Run it

```bash
cp .env.example .env        # point SURREAL_* at your SurrealDB (defaults to a local dev server)
```

```bash
schemic diff                # preview the DDL vs the stored snapshot
schemic gen init            # write the first migration from the diff
schemic migrate             # apply pending migrations to the database
schemic status              # show applied vs pending migrations + drift
```

> `sc` is the short alias for `schemic` (e.g. `sc diff`). `schemic check --schema` validates the
> schema without touching a server.
