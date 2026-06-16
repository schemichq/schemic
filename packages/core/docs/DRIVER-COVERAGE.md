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

**Legend:** `[ ]` not implemented · `[~]` partial (authoring-only / emit-only / no introspect / known
gaps) · `[x]` full round-trip (author → emit → introspect → diff = zero)

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
