# @schemic/core

The dialect-neutral engine behind [Schemic](https://github.com/schemichq/schemic) — schema-as-code
for any database. It defines the **driver contract**, the **portable schema IR**, and the
**diff / migration / snapshot** engine that the CLI runs over any driver.

`@schemic/core` has **no authoring surface of its own** — you don't write schemas with it directly.
A database driver provides that:

- A **driver** for your database — [`@schemic/surrealdb`](../surrealdb#readme) or
  [`@schemic/postgres`](../postgres#readme) — gives you the `s.*` authoring API and emits the DDL.
- [`@schemic/cli`](../cli#readme) gives you the `schemic` / `sc` commands.

The CLI loads your driver from `schemic.config.ts` and orchestrates this engine generically, so the
same workflow — author → diff → generate → migrate — works whatever database you target.

## When you touch it directly

Most projects depend on `@schemic/core` only transitively, through the CLI and a driver. The one
piece you import from it is the config helper:

```ts
import { defineConfig } from "@schemic/core/config";
// pair it with a connection factory from your driver
// (e.g. surrealConnection from @schemic/surrealdb, postgresConnection from @schemic/postgres)
```

With bun, npm, or yarn, `@schemic/core` is pulled in transitively (it's a dependency of the CLI and
every driver) — you don't install it directly. Under pnpm's strict `node_modules` the transitive copy
isn't reachable from your `schemic.config.ts`, so add it explicitly: `pnpm add @schemic/core`.

See your driver's README for the full `defineConfig({ connections: { … } })` setup.

## Docs

Guides, concepts, and reference live at [schemic.dev](https://schemic.dev). This package is part of
the [Schemic](https://github.com/schemichq/schemic) toolkit.

## License

[MIT](./LICENSE) © Vertio Solutions
