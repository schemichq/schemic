# Driver Coverage — template & worked example

> **This is the template.** Each driver package copies the structure into its own `docs/COVERAGE.md`
> and fills it for ITS database. The goal: a **complete, honest map of EVERY piece of the database's
> schema/DDL syntax** vs what the driver actually supports — so gaps are visible, not guessed.

## How to use

- List **all** of your database's schema surface, grouped by category — **including features you have
  NOT implemented**, so the gaps are explicit.
- Mark each with its status. A feature is `[x]` only when it **round-trips**: author with `s.*` → emit
  DDL → introspect back → diff to zero. Authoring-only / emit-only / no-introspect is `[~]`.
- Update it whenever you add or change a capability. Reference the `s.*` builder or driver capability
  where useful, and call out anything the driver deliberately drops, projects, or can't round-trip.
- Pair this map with a **verified example cookbook** (`examples/reference/*.ts`) — authoring + exact
  emitted DDL goldens, drift-proof. See `EXAMPLE-COOKBOOK-CONVENTION.md`.

**Legend:** `[ ]` not implemented · `[~]` partial (authoring-only / emit-only / no introspect / known
gaps) · `[x]` full round-trip (author → emit → introspect → diff = zero)

---

## Keep it honest — the machine-checked reconcile (shared convention)

This prose doc is **discipline**; on its own the done-vs-todo list silently drifts from reality (a kind
gets registered but never listed; a feature stays `[x]` after its test is deleted). Close that gap with
a **machine-checked manifest** reconciled in CI — a ratified cross-driver convention, with the
enforcement shared in core so every driver runs the *same* checks (not three copies that themselves
drift).

**1. Declare coverage as data** — a `test/coverage-manifest.ts` mirroring this doc, typed by core:

```ts
import type { KindCoverage, FeatureCoverage } from "@schemic/core/testing";

export const KIND_MANIFEST: KindCoverage[] = [
  { name: "table", status: "x" },
  { name: "view", status: "~", note: "name-only change detection; body edit is re-gen" },
];

export const FEATURE_MANIFEST: FeatureCoverage[] = [
  { key: "table.strict", kind: "table", status: "x", coveredBy: "STRICT table round-trips" },
  { key: "view.body", kind: "view", status: "~" }, // partial → no covering test required
];
```

`status` uses the same legend (`"x"`/`"~"`/`" "`). `coveredBy` is a **substring of a real test title**
and is **required for every `[x]` feature**. List `~`/` ` entries too — they fix the denominator so
gaps stay visible.

**2. Reconcile it in one `*.test.ts`** — the enforcement is `@schemic/core/testing`, so you write only
the call:

```ts
import { describeCoverageReconcile } from "@schemic/core/testing";
import { registry } from "../src/kinds";
import { KIND_MANIFEST, FEATURE_MANIFEST } from "./coverage-manifest";

describeCoverageReconcile({
  name: "sqlite",
  registry,
  kinds: KIND_MANIFEST,
  features: FEATURE_MANIFEST,
  testDir: import.meta.dir, // its *.test.ts are scanned to prove [x] features have a covering test
});
```

**What it enforces** (all off the neutral registry + your manifest, so nothing can drift by
construction):
1. `registry.names()` **exactly equals** the declared kinds, **both directions** — registering a kind
   without listing it (or vice versa) fails CI. This is the load-bearing check: the registered-kind
   side is the live code, not a hand-list.
2. every feature references a **registered kind**.
3. every **`[x]` feature names a covering test** that actually exists — matched against real,
   non-skipped `test()`/`it()` titles (a mention in a comment or a `.skip` test does **not** count).
4. no duplicate feature keys / kind entries.

> Deliberately **not** checked: "every kind defines `canonical()`". `KindEngine.canonical` is optional
> by contract (it defaults to `emit().join("\n")`), so a kind whose `emit` already is its canonical form
> correctly omits it. If you want the stricter "all MY kinds define an explicit `canonical`" invariant,
> assert it in a driver-local test — it isn't part of the shared convention.

The `reconcileCoverage(...)` pure function is exported too, if you'd rather assert the flattened
`failures` array in a single `test()` instead of the per-check `describe` block.

---

## Worked example — `@schemic/surrealdb` (illustrative; replace with your DB's surface)

> Statuses below are placeholders to show the FORMAT — `driver-dev-surrealdb` sets the real marks.

### Tables
- [x] `DEFINE TABLE … SCHEMAFULL | SCHEMALESS`
- [x] `TYPE NORMAL`
- [x] `TYPE RELATION [IN … OUT …] [ENFORCED]`  *(via `defineRelation`)*
- [x] `TYPE ANY`
- [~] `CHANGEFEED <dur> [INCLUDE ORIGINAL]` — emitted + carried in IR; introspect: <state>
- [x] `COMMENT`
- [x] table `PERMISSIONS FOR select/create/update/delete …`
- [ ] `DROP`-marked tables

### Fields & types
- [x] scalars: `string` `int` `float` `decimal` `number` `bool` `datetime` `uuid` `bytes` `duration`
- [x] `option<T>` (absent) **and** `T | null` (null) — kept distinct
- [x] `array<T>`, `array<T, N>`, `set<T>`
- [x] `record<table>` (+ `REFERENCE [ON DELETE REJECT|CASCADE|UNSET|IGNORE|THEN <expr>]`)
- [x] object / nested fields (`x.*`)
- [x] literals + literal unions (enums)
- [~] `geometry<…>` — <state>
- [ ] ranges / futures / other exotic types

### Field clauses
- [x] `DEFAULT [ALWAYS]`, `VALUE`, `ASSERT`, `READONLY`, `COMMENT`, `FLEXIBLE`, field `PERMISSIONS`
- [x] `COMPUTED`

### Indexes
- [x] `DEFINE INDEX … FIELDS/COLUMNS …`
- [x] `UNIQUE`
- [~] `SEARCH ANALYZER … BM25 …` (full-text) — <state>
- [~] `MTREE | HNSW | DISKANN` (vector) — <state>

### Events
- [x] `DEFINE EVENT … WHEN … THEN …`  *(via `defineEvent` / `.event()`)*
- [ ] `ASYNC` events

### Functions
- [x] `DEFINE FUNCTION fn::… (args) [-> returns] { body }`  *(via `defineFunction`)*

### Access / Auth
- [x] `DEFINE ACCESS … TYPE RECORD (SIGNUP / SIGNIN / AUTHENTICATE)`  *(via `defineAccess`)*
- [x] `TYPE JWT (ALG / KEY / URL)`
- [x] `TYPE BEARER FOR USER | RECORD`
- [x] `DURATION FOR TOKEN / SESSION / GRANT`
- [ ] `WITH JWT` record access

### Database-level objects
- [ ] `DEFINE PARAM`
- [ ] `DEFINE SEQUENCE`
- [ ] `DEFINE ANALYZER` (standalone)
- [ ] `DEFINE USER`
- [n/a] `DEFINE NAMESPACE / DATABASE` — managed at connect time, not part of the schema

### Driver semantics / known gaps
- Note any **projection** (e.g. Postgres collapsing `option<T>` and `T | null` into one nullable
  column), anything **dropped** on `normalize`, secrets that are **redacted** on introspect, or
  features that **emit but don't introspect** (so they can't round-trip to `[x]` yet). Be explicit —
  this section is where the honesty lives.

---

> Categories above are SurrealDB-shaped. For a SQL database, expect: schemas/tables, column types +
> nullability + defaults + generated/computed columns, primary keys, **foreign keys + ON DELETE/UPDATE**,
> unique/check constraints, indexes (btree/gin/gist/…), enums/domains, views, functions/procedures,
> triggers, RLS policies, extensions, sequences. Keep the same legend and the same "list it even if
> unimplemented" rule.
