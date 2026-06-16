# Coverage — `@schemic/surrealdb`

A complete, honest map of **every piece of SurrealDB's schema/DDL surface** vs what this driver
actually supports. Gaps are listed explicitly, not guessed — so what's missing is visible.

**Legend:** `[ ]` not implemented · `[~]` partial (authoring-only / emit-only / no introspect / known
gaps) · `[x]` full round-trip (author → emit → introspect → diff = zero)

A feature is `[x]` only when it **round-trips**: author with `s.*` / `define*` → emit DDL → apply →
introspect (`INFO FOR DB/TABLE … STRUCTURE`) → diff to zero. The `[x]` marks below are backed by the
live parity suites (`test/parity/{struct,live,canonical}-parity.test.ts`) and the e2e suites
(`test/e2e/{three-state,lifecycle,pull}.e2e.test.ts`), probed against **SurrealDB 3.1.3**.

> Scope: this tracks the **schema/DDL** surface (the things a migration defines). Runtime query
> features (SELECT/graph traversal/LIVE/etc.) are out of scope — they belong to the query layer.

---

## Tables

- [x] `DEFINE TABLE … SCHEMAFULL | SCHEMALESS` — `defineTable(...).schemafull()` / `.schemaless()`
- [x] `TYPE NORMAL` — default
- [x] `TYPE ANY` — `.typeAny()`
- [x] `TYPE RELATION [IN … OUT …] [ENFORCED]` — `defineRelation()` + `.from()` / `.to()` / `.enforced()`
- [x] `COMMENT` — `.comment(text)`
- [x] table `PERMISSIONS FOR select/create/update/delete [WHERE …]` — `.permissions(spec)`
- [x] `CHANGEFEED <dur> [INCLUDE ORIGINAL]` — `.changefeed(expiry, opts?)` (emitted + introspected)
- [x] `DROP`-marked tables — `.drop(true)`
- [ ] `DEFINE TABLE … AS SELECT …` (views / computed/materialized tables) — no builder; not introspected
- [ ] `ALTER TABLE` / table-level `CHANGEFEED` drop semantics beyond redefine

## Fields & types

### Scalars
- [x] `string` `int` `float` `decimal` `number` `bool` `datetime` `uuid` `bytes` `duration` `file`
  — `s.string()` `s.int()` `s.float()` `s.decimal()` `s.number()` `s.boolean()` `s.datetime()`
  `s.uuid()` `s.bytes()` `s.duration()` `s.file()` (plus `s.int32/uint32/bigint`, `s.date` alias)
- [x] `any` (`s.any()` / `s.unknown()`), `null` (`s.null()`)

### Optionality (kept distinct — not collapsed)
- [x] `option<T>` (absent) — `.optional()` / `s.optional()`
- [x] `T | null` (present-but-null) — `.nullable()` / `s.nullable()`
- [x] `option<T | null>` — `.nullish()` / `s.nullish()`

### Containers
- [x] `array<T>`, `array<T, N>` — `s.array(T, { max })`
- [x] `set<T>`, `set<T, N>` — `s.set(T, { max })`
- [x] object / nested fields to arbitrary depth (`x.*`) — `s.object(shape)`
- [x] tuples `[T1, T2, …]` — `s.tuple([...])`
- [x] literal / literal-union (enums) — `s.literal()` / `s.enum()` / `s.nativeEnum()`
- [x] scalar unions `T1 | T2` — `s.union([...])`
- [~] open-keyed object (`s.record(k, v)` / `s.map(k, v)`) — emitted + round-trips **as `object`**
  (the open key/value shape is projected to a flexible object, not a typed map)
- [~] discriminated unions of **objects** — `s.discriminatedUnion()` emits & the DB accepts it, but the
  canonical/normalize step collapses object-literal unions to a plain `object` (no round-trip yet)

### Record links
- [x] `record<table>`, `record<a | b | …>`, `array<record<…>>` — `s.recordId(table | [tables])`
- [x] `REFERENCE [ON DELETE REJECT | CASCADE | UNSET | IGNORE | THEN <expr>]` — `.reference({ onDelete })`

### Geometry
- [x] `geometry` (bare) and `geometry<point|line|polygon|multipoint|multiline|multipolygon|collection>`
  — `s.geometry(kind?)` (all 7 kinds + bare round-trip)

### Not-yet-typed
- [ ] `range<T>` — DB supports `TYPE range`; no `s.range()` builder, not introspected
- [ ] `regex` — DB supports `TYPE regex`; no `s.regex()` builder, not introspected
- [ ] `future` fields

## Field clauses

- [x] `DEFAULT` and `DEFAULT ALWAYS` — `.$default()` / `.$defaultAlways()` (literal vs `surql\`…\``
  preserved on round-trip: bare literals stay bare, surql stays wrapped)
- [x] `VALUE <expr>` — `.$value(surql)`
- [x] `COMPUTED <expr>` — `.$computed(surql)`
- [x] `ASSERT <expr>` — `.$assert(surql?)`, plus `$`-constraints that bake asserts
  (`.$min/$max/$length/$regex/$gt/$gte/$lt/$lte`)
- [x] string-format builders reverse from their baked `ASSERT` on pull — `s.email()`, `s.url()`,
  `s.ipv4/ipv6`, `s.ulid()`, `s.alpha/alphanum/ascii/numeric/semver/hexadecimal/latitude/longitude/ip/domain`
  recover as the builder (not raw `string ASSERT …`)
- [x] `READONLY` — `.$readonly()`
- [x] `COMMENT` — `.$comment(text)`
- [x] `FLEXIBLE` (object) — `.flexible()` / `.loose()`
- [x] field `PERMISSIONS FOR select/create/update [WHERE …]` — `.$permissions(spec)` (no `delete` op
  at field level, matching SurrealQL)

## Indexes

- [x] `DEFINE INDEX … FIELDS …` — `field.index()` (single) / `table.index(name, fields)` (composite)
- [x] `UNIQUE` (single + composite) — `field.unique()` / `table.index(name, fields, { unique: true })`
- [x] `COUNT` (materialized row-count, no `FIELDS`) — `table.index(name, [], { count: true })`
- [ ] `SEARCH ANALYZER … BM25 …` (full-text) — no builder; not introspected
- [ ] vector `MTREE | HNSW | DISKANN` — no builder; not introspected
- [ ] index modifiers `CONCURRENTLY` / `DEFER`

## Events

- [x] `DEFINE EVENT … [WHEN …] THEN …` — `table.event(name, spec)` / `defineEvent(table, name, spec)`
  (omitted `WHEN` round-trips; `THEN` accepts a single expr or ordered array)
- [ ] `ASYNC` events

## Functions

- [x] `DEFINE FUNCTION fn::…(args) [-> returns] { body } [PERMISSIONS …] [COMMENT …]`
  — `defineFunction(name, args).returns().body().permissions().comment()`
  - Caveat: the body is stored verbatim and SurrealDB may reformat quote style; semantically identical,
    tracked as an allowlisted canonical divergence (see Driver semantics).

## Access / Auth

- [x] `DEFINE ACCESS … TYPE RECORD (SIGNUP / SIGNIN / AUTHENTICATE)` — `defineAccess(name).record()`
- [x] `DURATION FOR TOKEN / SESSION / GRANT` — `.duration(...)`
- [x] `ON NAMESPACE | ON DATABASE` — `.onNamespace()` / `.onDatabase()`
- [~] `TYPE JWT (ALG / KEY / URL)` — `.jwt({ alg, key | url })`: structure (alg + JWKS url) applies and
  introspects, but **SurrealDB redacts the signing `KEY`** — it can't be pulled, and re-applying rotates
  it. Pull emits a warning comment instead of the secret.
- [~] `TYPE BEARER FOR USER | RECORD` — `.bearer({ for })`: subject + duration round-trip; the grant
  **secret is redacted** on introspect (same redaction caveat as JWT).
- [ ] `WITH JWT` clause on bearer / record access
- [ ] OIDC access configuration

## Database-level objects

- [ ] `DEFINE PARAM`
- [ ] `DEFINE SEQUENCE`
- [ ] `DEFINE ANALYZER` (standalone — also blocks full-text indexes above)
- [ ] `DEFINE USER`
- [ ] `DEFINE CONFIG` / `DEFINE API` / `DEFINE BUCKET` / `DEFINE MODEL`
- [n/a] `DEFINE NAMESPACE` / `DEFINE DATABASE` — managed at connect time, not part of the schema

---

## Driver semantics / known gaps

This is where the honesty lives — projections, redactions, and emit-but-don't-introspect cases.

- **Secrets are redacted on introspect.** JWT signing keys and BEARER grant secrets are never returned
  by SurrealDB. A `pull` emits `// NOTE: signing key not pulled (SurrealDB redacts it) — re-applying
  rotates it.` rather than a fake value. So JWT/BEARER are `[~]`: shape round-trips, secret does not.
- **`option<T>` and `T | null` are kept distinct** (absent vs present-null) — unlike SQL drivers that
  collapse both into one nullable column.
- **Object-literal unions collapse.** `s.discriminatedUnion()` / unions of `s.object()` emit and apply,
  but normalize/canonical reduces them to a plain `object`, so they don't round-trip to `[x]` yet.
- **Open maps project to objects.** `s.record(k, v)` / `s.map(k, v)` round-trip as a flexible `object`,
  not as a key/value-typed map.
- **App-only types have no DDL mapping** unless given an explicit wire type via `.$surreal(wire, codec)`:
  `s.symbol/undefined/void/never/nan/promise/custom/instanceof`. `s.coerce.*` is app-side validation
  only — the wire type is unchanged.
- **Trivial array element fields fold into the parent** — an auto-created `field[*]` with no clauses is
  absorbed into `array<T>`; element-level clauses (`x.* FLEXIBLE/permissions/readonly/assert/comment`)
  are preserved.
- **Allowlisted canonical divergences** (tracked in `test/parity/canonical-parity.test.ts`, acceptable
  for shadow-verify — emitted DDL differs textually but is semantically equal):
  1. union member ordering (generator preserves authored order; INFO-canonical sorts)
  2. `DEFAULT` quote style (generator double-quotes; SurrealDB stores single-quoted)
  3. explicit default-valued permission ops (generator emits them; canonical omits)
  4. function body formatting (verbatim; SurrealDB may reformat quotes)

## At a glance

| Area | Status |
|---|---|
| Tables (schema mode, type, perms, changefeed, comment, drop, relations) | `[x]` — views `[ ]` |
| Field types (scalars, geometry, containers, records, literals, unions, tuples, optionality) | `[x]` — range/regex `[ ]`, object-unions/open-maps `[~]` |
| Field clauses (default/value/computed/assert/readonly/comment/flexible/permissions/reference) | `[x]` |
| Indexes (plain, unique, composite, count) | `[x]` — full-text/vector/modifiers `[ ]` |
| Events | `[x]` — `ASYNC` `[ ]` |
| Functions | `[x]` (body-format caveat) |
| Access/Auth (RECORD) | `[x]` |
| Access/Auth (JWT, BEARER) | `[~]` — secrets redacted |
| DB-level (param/sequence/analyzer/user/config/api/bucket/model) | `[ ]` |
