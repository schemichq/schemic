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

## Worktrees (don't step on each other)

The repo is a **shared working directory** — multiple agents check it out. So one agent's
`git checkout`/commit can land on another's branch (it has happened). **Each agent works in its own
git worktree, on its own branch:**

```bash
git worktree add .claude/worktrees/<your-name> -b <your-branch> <base>
cd .claude/worktrees/<your-name>
# do ALL your edits + commits HERE, on your branch only
```

- **Base off the branch that has the contract you build against** — often a feature branch `core-dev`
  points you to, *not necessarily `main`* (e.g. a new API may live on a feature branch until it lands).
- **Never** commit onto another agent's branch or the shared checkout. Push your branch and **DM the
  owner** (usually `core-dev`) to integrate.

**Continuous deployment.** `core-dev` lands every PR with **`bun scripts/land.ts <branch>`**, which is
the whole pipeline: rebase the branch onto `main`, fast-forward-merge it, **gate it** (typecheck +
test the workspace — a red gate rolls `main` back and ships nothing), push `main`, remove the branch's
worktree + delete the branch, then **deploy** — cut the next prerelease (`bun scripts/release.ts next`,
lockstep all 6 to npm) and push the version bumps. So **every merge ships a release**; pass
`--no-deploy` only to batch a change into the next deploy. After your PR lands, your worktree is gone
— start a fresh one off the latest `main` for your next task; never keep working in a landed worktree.

## Driver coverage docs

Each driver package keeps a **`docs/COVERAGE.md`** tracking **all** of its database's schema/DDL syntax
and the implementation status of each (author → emit → introspect → diff). Template + worked example:
**`packages/core/docs/DRIVER-COVERAGE.md`**. Keep it **exhaustive** — list features even when not yet
implemented, so gaps stay visible rather than guessed.
