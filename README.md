<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner.png" />
  <img alt="Schemic — schema-as-code for any database, in the Zod you already know" src=".github/assets/banner-light.png" />
</picture>

<br />

[Docs](https://schemic.dev) &nbsp;•&nbsp; [Drivers](#drivers) &nbsp;•&nbsp; [GitHub](https://github.com/schemichq/schemic)

[![npm](https://img.shields.io/npm/v/@schemic/cli)](https://www.npmjs.com/package/@schemic/cli) &nbsp; [![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

---

Schemic lets you define your database schema once in TypeScript — with the
**[Zod](https://zod.dev) API you already know** — and turns that single definition
into your database's native DDL, end-to-end types, and reviewable migrations.

The engine and CLI are **dialect-neutral**; each database is an installable
**driver**, so the same schema targets any of them. One source of truth — no
separate ORM model, no code generation, no drift.

## Drivers

- [`@schemic/surrealdb`](packages/surrealdb#readme) — **SurrealDB** · available
- [`@schemic/postgres`](packages/postgres#readme) — **PostgreSQL** · in progress

More drivers are planned. The authoring API and the CLI are the same across
every driver — only the generated DDL differs.

## Packages

| Package | What it is |
| --- | --- |
| [`@schemic/core`](packages/core#readme) | The dialect-neutral engine: the `Driver` contract, the portable schema IR, and the migration / diff / snapshot engine. Zero dialect code. |
| [`@schemic/cli`](packages/cli#readme) | The `schemic` / `sc` binary — also dialect-neutral; loads your driver from `config.driver`. |
| `@schemic/<driver>` | A database driver: connection, authoring, and the dialect's DDL. See [Drivers](#drivers) for the available ones. |

## The workflow

Author your schema, then drive it from the dialect-neutral CLI (`sc` is the
short alias):

```bash
sc init        # scaffold a project: schemic.config.ts + schema + .env.example
sc diff        # preview changes vs the last snapshot   (--ts for a TypeScript view)
sc gen         # write a migration for the pending change
sc migrate     # apply pending migrations
sc status      # show applied vs pending migrations
sc pull        # introspect a live database back into TypeScript
```

The authoring API and the DDL it generates are driver-specific — see your
driver's README for the exact builders and output.

## Status

**Alpha (`0.x`).** APIs may still change.

- [x] **SurrealDB** driver — the most complete · [coverage](packages/surrealdb/docs/COVERAGE.md)
- [ ] **PostgreSQL** driver — in progress · [coverage](packages/postgres/docs/COVERAGE.md)
- [ ] more drivers

## Development

A [Bun](https://bun.com) workspaces monorepo (`packages/*`).

```bash
bun install
bun --filter '@schemic/*' test       # run every package's tests
bun --filter '@schemic/*' typecheck
```

## License

[MIT](LICENSE) © Vertio Solutions
