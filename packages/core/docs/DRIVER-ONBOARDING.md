# Building a Schemic driver — onboarding index

The authoritative starting point for a NEW driver package (`@schemic/<driver>`). Owned by `core-dev`.
It ties together the contract you implement, the package skeleton you mirror, and the ratified
cross-driver conventions that are NON-negotiable. Read this first, then the linked docs for depth.

The two reference drivers: **`drivers/postgres`** (SQL-relational — the closest reference for any
SQL/libSQL/SQLite dialect) and **`drivers/surrealdb`** (document/graph — a different model, but the
richest feature surface). Pick the one nearest your dialect as your structural template.

## 1. What core owns vs what you own

- **Core owns** (`@schemic/core`): the dialect-neutral engine (kind registry, diff, snapshot,
  migration spine), the `Driver` contract, the neutral authoring substrate (`SFieldBase`, the Zod
  `s.*` field base, `PortableType`, codecs), and the CLI. You implement AGAINST these; you never edit
  them. Contract changes are proposed to `core-dev` (DM).
- **You own** (`@schemic/<driver>`): the dialect's `s.*` authoring surface, the `lower`/`emit`/
  `introspect` behavior of each kind, the connection factory, and the driver's ORM/query surface.

## 2. The Driver contract

`packages/core/src/driver/driver.ts` — `interface Driver<Conn, Tbl, Def>`. Import everything from the
neutral SDK entry **`@schemic/core/driver`** (`packages/core/src/driver/sdk.ts`) — never reach into
core internals. The contract splits into:

**Required (the spine):**
- `name` — the string `config.driver` resolves to.
- `registry: KindRegistry` — your registered KINDS (§4). Core runs lower/diff/emit/order generically
  over it and never names a kind.
- `explode(tables, defs) => Definable[]` — fan one authored `defineTable` out into its kinded pieces
  (`[table, ...index, ...event/constraint]`), each tagged with `kind`. Core then lowers via
  `lowerSchema(registry, explode(...))`.
- `introspectAll(conn, exclude?) => Promise<PortableObject[]>` — live DB -> ALL portable objects from
  ONE read. MUST canonicalize IDENTICALLY to lowering (a clean apply round-trips to a zero diff) and
  be COMPLETE (every diffable kind, or presence phantom-diffs).
- `connect(config, over?) / apply(conn, statements, opts?) / close(conn)` — execution lifecycle. The
  orchestration owns the lifecycle; `close` tears down what `connect` opened.

**Optional capabilities (a driver that omits one makes that CLI command unavailable — the CLI never
hardcodes `if surreal`):**
- `migrations?: MigrationStore<Conn>` — apply-time bookkeeping; ABSENT means diff/gen still work but
  the driver can't run migrations.
- `shadow?: ShadowCapability<Conn>` — a throwaway engine for `check`/replay/shadow-diff.
- `diffLive?` / `syncPlan?` — live diff to up/down DDL, and its reduction for `push`.
- `commands?: readonly DriverCommand<Conn>[]` — dialect CLI commands as `sc <kind> <verb> [args]`
  (§6). Core discovers + dispatches; it never names a kind/verb.
- `renderSchema?` / `diffTsLive?` / `planPull?` — codegen behind `diff --ts` and `pull`.
- `checkReplay?` — replay migrations into a shadow engine and diff (`check`).
- `serverInfo?` — a human server identity for `doctor`.
- `query?` — raw READ for connection resolvers + `seed`.
- `callable?: CallableFunctions<Conn>` — the `.call()` surface for user-defined DB functions.
- `initScaffold?` / `scaffoldEntity?` — the files `schemic init` / `schemic new` write.

**The one round-trip invariant that governs everything:**
`author -> lower -> explode -> emit -> introspect -> buildKindDiff` MUST be a ZERO diff for a clean,
in-sync schema. Every design decision (normalization, canonical form, introspection completeness)
serves this.

## 3. Registration + the dual-instance rule (READ THIS)

Ship `registerDriver(myDriver)` as a SIDE-EFFECT of the `@schemic/<driver>/driver` subpath ONLY. The
registry is a `globalThis` `Symbol.for("@schemic/core.driverRegistry")` singleton so the CLI's core
and the project's core share ONE map. Two consequences:
- Any module-level registry YOU keep (field registries, kind maps) must ALSO be a `globalThis`
  `Symbol.for` singleton — the subpath split duplicates plain module-level state, and a bundled `lib/`
  only reveals it in e2e. (See `packages/core/docs/AUTHORING-SPLIT.md`.)
- If your DB SDK has nominal `#private` classes (most do), make it a PEER dependency and re-export its
  value surface from your authoring index, so an app resolves ONE copy — dual instances break
  `instanceof` and cross-instance assignability. (surrealdb hit this live; postgres/PGlite too.)

## 4. The kind registry

`packages/core/docs/kind-registry-contract.md` (+ `kind-registry.md`). Each schema object type is a
KIND you register into your `KindRegistry`. A kind binds an authoring object (`A extends Definable`)
to a `KindEngine<A, P>`:
- `lower(A) => P` — authored -> normalized portable object.
- `emit(P) => string[]` / `remove(P) => string[]` / `overwrite?(prev, next) => string[]`.
- `canonical?(P) => string` — the change-detection key. `canonical(a) === canonical(b)` MUST mean
  "no migration needed". This is where phantom-diff prevention lives: keep `emit` faithful, but
  EXCLUDE from the canonical key any clause the DB rewrites on read (`'x'::text`, `(a>0)`) or never
  introspects. Also normalize FORMATTING (whitespace/quoting) into canonical form so multi-line
  bodies don't phantom-diff against the DB's single-line printing — normalize on BOTH compare sides
  from day one (the single most common trap).
- `deps?/owner?` — cross-kind dependency edges for apply ordering.
- `introspect?` — live -> portable for this kind.
- `excludeFromMigrations?` — the kind opts OUT of the migration pipeline; it is managed out-of-band by
  your own `sc <kind>` commands (worked example: surreal `DEFINE ACCESS`, `DEFINE PARAM` secrets).

Fields/types are NOT a kind — they are the shared core substrate every kind composes.

## 5. Package skeleton (mirror a reference driver)

Purpose-based subpaths, so app code only bundles what it imports (`package.json#exports`):

| Subpath | Contents | Side effects |
|---|---|---|
| `@schemic/<driver>` | authoring: `s.*`, `define*`, the raw-body tag; SDK value re-exports | **NONE** (pure) |
| `@schemic/<driver>/connection` | the `<driver>Connection(...)` factory | none |
| `@schemic/<driver>/query` | the opt-in query builder (composes `@schemic/core/query`) | none |
| `@schemic/<driver>/client` | the bound ORM client (`connect`) | none |
| `@schemic/<driver>/driver` | the `Driver` impl + `lower`/`emit*`/`introspect` + `registerDriver` | registers |

The CLI loader REQUIRES the `/driver` entry (drivers >= alpha.21). Keep `emit*`/`lower`/`introspect`
OUT of the authoring index so importing `s.*` never drags the engine into an app bundle. Postgres
source layout is the clean template: `authoring.ts -> lower.ts -> emit.ts -> driver.ts -> kinds.ts`.

## 6. Must-mirror conventions (all ratified cross-driver — NON-negotiable)

- **Subpath split** (§5) + **`/driver`-only registerDriver** (§3).
- **Connections v2**: `<driver>Connection(config | (ctx, args) => config | config[])` — typed
  resolver args (2nd param), array = bulk-only fleet, `key`/`label` display labels; chained
  `defineConfig().connection(name, factory, ...)` with accumulated typed `ctx.connections`.
  (`packages/core/docs/MULTI-CONNECTION.md`.)
- **Config-as-factory**: `defineConfig` returns the typed `connect(name, args?)`; accept default OR
  named `schemic` export; `schemic.ts` discovered.
- **ORM client** at `/client`: `connect(name?)` managed / `connect(sdkClient)` BYO (BYO `close` is a
  NO-OP, hard rule), AsyncDisposable, pre-bound thenable builders; split writes
  (`create(T).content(...)`, `update(T,id).merge/.content/.set`, delete/`remove`); rows carry their
  typed id; `db.query` is SDK-FAITHFUL (no silent decode) with `.as(...)` opt-in decode.
- **Query builder** at `/query`: the shared cross-driver op contract (eq/neq/gt/gte/lt/lte, in/notIn,
  isNone/isNull, startsWith/endsWith, contains*), pagination, `.one()/.get()/.count()`.
- **Table composition + presets**: `s.object().fields`, `TableDef.extend`, derived `.create`/`.update`
  input schemas; `defineTable.preset(...)` applied via chained single-arg `TableDef.use(a).use(b)` —
  presets MUST preserve the declared id value type (don't re-derive it and drop tuple/literal ids).
- **`defineSingleton`**: DB-enforced one-record tables with id-optional client sugar.
- **Secrets**: `env()`/`secret()` -> value never in schema/snapshot/migration; resolved at apply as a
  bound param; secret-bearing kinds go `excludeFromMigrations` + out-of-band `sc <kind> push/check`.
  The honest framing: OUT of committed source, NOT at-rest encryption.
- **`s.*` = Zod 4 drop-in + Standard Schema** on every field; live-verify every DDL/builtin spelling
  against the REAL engine (the fn-catalog exhaustive-sweep pattern), and keep an exhaustive
  `docs/COVERAGE.md` from day one (author -> emit -> introspect -> diff status per feature; template:
  `packages/core/docs/DRIVER-COVERAGE.md`). Back it with the machine-checked reconcile
  (`describeCoverageReconcile` from `@schemic/core/testing` + a `coverage-manifest.ts`) so the
  done-vs-todo list can't silently drift from the registered kinds — see the template's reconcile
  section.

## 7. Process

- Work in your OWN git worktree on your OWN branch (the checkout is shared — never commit on `main` or
  another agent's branch). Request integration with a one-line PR in `#prs` (write-only: post and
  leave; `core-dev` is the only listener and lands from there — confirmations come back in `#general`
  or DM). Additive + green + backward-compatible auto-lands; a BREAKING waits on Manuel.
- `core-dev` lands via `bun scripts/land.ts <branch>` (gate = build + typecheck + per-package tests; a
  red gate rolls `main` back). Landing ACCUMULATES; releases are cut lockstep on Manuel's word.
- Core/API questions: DM `core-dev` (or `#general`). `#drivers` is `core-dev`'s broadcast channel for
  completed core + public-API changes you must track — read it, don't post in it.

## 8. Deeper reading

`kind-registry-contract.md` · `kind-registry.md` · `AUTHORING-SPLIT.md` · `MULTI-CONNECTION.md` ·
`STRUCT-IR.md` · `PARITY.md` · `ESCAPE-HATCH-CONVENTION.md` · `query-builder-design.md` ·
`DRIVER-COVERAGE.md` (template) · `proposals/` (ratified designs) · each driver's `docs/COVERAGE.md`.
