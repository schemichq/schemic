# Schemic — repo guide for agents

Schemic is a **driver-based, schema-as-code** toolkit: author your database schema in TypeScript,
generate the target dialect's DDL, and manage migrations — across databases via installed driver
packages. Monorepo (bun workspaces, `packages/*`).

Architecture: `@schemic/core` (dialect-neutral engine: the `Driver` contract + portable schema IR +
the migration/diff/snapshot engine) ← `@schemic/cli` (the `schemic`/`sc` bin, ZERO dialect code,
dynamic driver loading by `config.driver`) + per-database driver packages (`@schemic/surrealdb`,
`@schemic/postgres`, …) that own connection + authoring (`s.*`) + DDL.

**Package surface (purpose-based subpaths).** Each driver splits its surface so app code only bundles
what it imports:
- `@schemic/<driver>` — **authoring** (`s.*`, `define*`, raw-body tag) — must be **side-effect-free**.
- `@schemic/<driver>/connection` — the connection factory.
- `@schemic/<driver>/query` — the opt-in query builder (composes `@schemic/core/query`).
- `@schemic/<driver>/driver` — the `Driver` impl + `emit*`/`lower`/`introspect` + the **`registerDriver`
  side-effect** (CLI/engine-only; keep `emit*` etc. OUT of the authoring index).

The CLI loader imports `/driver` to register (it **requires** the `/driver` entry — drivers >= alpha.21),
so importing `s.*` never drags the diff/emit engine into an app bundle. Core mirrors this:
`@schemic/core/query` is the neutral query toolkit (`Row`/`Project`/`decodeProjection`/`callFunction`).

## Developer experience IS the product — always analyze through a DevEx lens

Schemic is a **developer-focused product**: the authoring surface (`s.*`/`define*`) and the CLI ARE the
product, so DX *is* the deliverable. **Analyze every API, change, and review (code + coverage) through a
developer-experience lens** — is it type-safe, autocompletable, refactor-safe, hard to misuse, and obvious
at the call site? Treat stringly-typed escape hatches, undeclared "magic" variables, and silent-failure
APIs as **DX debt**: surface them and propose the strongly-typed form *even when the current behavior
already "works"*. This analysis is mandatory in every review, not optional polish.

## Agent Code Ownership

This repo is developed by **multiple AI agents in parallel**. Stay within your package(s); a change in
another package goes through that package's owner.

| Owner | Package(s) | Scope |
|---|---|---|
| **core-dev** | `packages/core` (`@schemic/core`), `packages/cli` (`@schemic/cli`) | the dialect-neutral engine + the CLI; the **Driver contract + the public neutral API**; cross-cutting design; this file |
| **driver-dev-surrealdb** | `drivers/surrealdb` (`@schemic/surrealdb`) | the SurrealDB driver + its `s.*` authoring surface |
| **driver-dev-postgres** | `drivers/postgres` (`@schemic/postgres`) | the PostgreSQL driver + its authoring surface |

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

## Manuel's attention → use Tasks, not inline reminders (CONTRACT)

Anything **pending Manuel's attention** — a decision, an approval (e.g. a BREAKING land), a security/
secret action, a release-cut call, anything only he can decide — goes into the **session Task list**,
never an inline "just a reminder that X is pending" in chat prose. The Task list is **persistent**, so
Manuel can review it any time and ask again; he marks each item done as he attends it.

- **Per-agent, not centralized.** EACH agent keeps its OWN pending-Manuel items in its OWN session Task
  list (visible in that agent's chat). Do **not** route them to `core-dev` — Manuel reviews each agent's
  chat for that agent's items.
- **Don't pester inline.** Surface a pending item once when it arises (as a Task), then stop re-raising
  it in prose. Act on everything you can decide yourself; only genuinely Manuel-only items become Tasks.
- **Task naming** follows whatever format Manuel asked for (e.g. tracked secrets: `npm key: <id…> <date>`).

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

**Landing + releases.** `core-dev` lands every PR with **`bun scripts/land.ts <branch>`**: rebase onto
`main`, fast-forward-merge, **gate it** (typecheck + test the workspace — a red gate rolls `main` back and
ships nothing), push `main`, remove the branch's worktree + delete the branch. **Landing ACCUMULATES — it
does NOT deploy.** Releases are **cut explicitly on Manuel's confirmation**: review the accumulated
changes, then `core-dev` runs **`bun scripts/release.ts next`** (lockstep all 6 to npm) + commits/pushes
the version bumps + stamps the CHANGELOG. So changes pile up on `main` between releases; nothing publishes
until Manuel says cut. (`land.ts --deploy` land+ships in one step — used only when Manuel wants immediate
release.) After your PR lands, your worktree is gone — start a fresh one off the latest `main`; never keep
working in a landed worktree.

## Driver coverage docs

Each driver package keeps a **`docs/COVERAGE.md`** tracking **all** of its database's schema/DDL syntax
and the implementation status of each (author → emit → introspect → diff). Template + worked example:
**`packages/core/docs/DRIVER-COVERAGE.md`**. Keep it **exhaustive** — list features even when not yet
implemented, so gaps stay visible rather than guessed.
