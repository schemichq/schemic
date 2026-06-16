# Schemic — repo guide for agents

Schemic is a **driver-based, schema-as-code** toolkit: author your database schema in TypeScript,
generate the target dialect's DDL, and manage migrations — across databases via installed driver
packages. Monorepo (bun workspaces, `packages/*`).

Architecture: `@schemic/core` (dialect-neutral engine: the `Driver` contract + portable schema IR +
the migration/diff/snapshot engine) ← `@schemic/cli` (the `schemic`/`sc` bin, ZERO dialect code,
dynamic driver loading by `config.driver`) + per-database driver packages (`@schemic/surrealdb`,
`@schemic/postgres`, …) that own connection + authoring (`s.*`) + DDL.

## Agent Code Ownership

This repo is developed by **multiple AI agents in parallel**. Stay within your package(s); a change in
another package goes through that package's owner.

| Owner | Package(s) | Scope |
|---|---|---|
| **core-dev** | `packages/core` (`@schemic/core`), `packages/cli` (`@schemic/cli`) | the dialect-neutral engine + the CLI; the **Driver contract + the public neutral API**; cross-cutting design; this file |
| **driver-dev-surrealdb** | `packages/surrealdb` (`@schemic/surrealdb`) | the SurrealDB driver + its `s.*` authoring surface |
| **driver-dev-postgres** | `packages/postgres` (`@schemic/postgres`) | the PostgreSQL driver + its authoring surface |

Rules:
- **Edit only your own package(s).** Need a change elsewhere? Ask its owner.
- **The `Driver` contract and the public authoring/neutral API are owned by `core-dev`.** Drivers
  implement against them; propose contract changes to `core-dev` (DM).
- Examples/docs/site are shared — coordinate before touching another owner's references.

## Bridge channels (agent coordination)

- **`#general`** — **everyone joins.** General discussion + coordination + cross-team questions.
- **`#drivers`** — **`core-dev`'s broadcast channel. ONLY `core-dev` writes here**, to announce
  completed `@schemic/core` changes and **public authoring-API changes** that drivers must track.
  Everyone else: **DM `core-dev` directly** for core/API questions, or discuss in `#general`. **Do not
  post in `#drivers`.**

## Driver coverage docs

Each driver package keeps a **`docs/COVERAGE.md`** tracking **all** of its database's schema/DDL syntax
and the implementation status of each (author → emit → introspect → diff). Template + worked example:
**`packages/core/docs/DRIVER-COVERAGE.md`**. Keep it **exhaustive** — list features even when not yet
implemented, so gaps stay visible rather than guessed.
