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

> **Worked examples:** every `[x]` feature below has a runnable, verified entry in the
> [reference cookbook](../examples) (`examples/*.ts`) pairing the `s.*` / `define*` authoring with the
> exact SurrealQL it emits — asserted by `test/examples/reference.test.ts` (`emit(defs) === ddl`), so
> the catalog can't drift. See the per-driver
> [example-cookbook convention](../../core/docs/EXAMPLE-COOKBOOK-CONVENTION.md).

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
- [x] `TYPE RELATION … ENFORCED` — `defineRelation().enforced()` (round-trips: introspect + canonical + pull)
- [x] `DEFINE TABLE … AS SELECT …` (pre-computed/materialized view tables) — `defineView(name, surql\`SELECT …\`)`
- [ ] `ALTER TABLE` / table-level `CHANGEFEED` drop semantics beyond redefine

> The **full `DEFINE TABLE` head round-trips** (push + pull) — every permutation is exercised live in
> `test/parity/define-table.test.ts` against SurrealDB 3.1.3.

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

- [x] `DEFINE INDEX … FIELDS …` — `field.$index(name?)` (single) / `table.index(name, fields)` (composite)
- [x] `UNIQUE` (single + composite) — `field.$unique(name?)` / `table.index(name, fields, { unique: true })`
- [x] `COUNT` (materialized row-count, no `FIELDS`) — `table.index(name, [], { count: true })`
- [x] `COMMENT <string>` — `table.index(name, fields, { comment })`
- [x] vector `HNSW DIMENSION … [DIST/TYPE/EFC/M]` — `field.$hnsw({…})` (single) / `table.index(name, [field], { hnsw: {…} })` (defaults stripped → round-trips)
- [x] vector `DISKANN DIMENSION … [DIST/TYPE/DEGREE/L_BUILD/ALPHA]` — `field.$diskann({…})` (single) / `table.index(name, [field], { diskann: {…} })`
- [x] `FULLTEXT [ANALYZER …] [BM25] [HIGHLIGHTS]` (full-text) — `field.$fulltext()` / `field.$fulltext(analyzer | { analyzer?, bm25?, highlights?, name? })` (single; overloaded — `analyzer` optional, accepts a name string or the `AnalyzerDef`) / `table.index(name, [field], { fulltext: { analyzer?, bm25?, highlights? } })`. `analyzer` is OPTIONAL — omit it and SurrealDB injects its built-in `like` analyzer (bare `DEFINE INDEX … FULLTEXT` is valid; verified live 3.1.4). Two DB-materialized defaults are stripped from the canonical/migration DDL (DB re-applies on apply) so authoring ↔ introspection match: the `like` analyzer, and BM25 (always-on with `[1.2,0.75]`). BM25 has no "off" and no "use-default" toggle, so `bm25` is a TUNING tuple `[k1,b]` ONLY (not a boolean) — omit for the default, a NON-default `[k,b]` is kept in the DDL. The index→analyzer dep is matched on the bare name (stops at `;`).
- [n/a] index build hints `CONCURRENTLY` / `DEFER` — apply-time only; not part of the stored schema (`INFO` doesn't return them)

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
- [x] `DURATION FOR TOKEN / SESSION / GRANT` — `.duration(...)`. SurrealDB materializes duration
  defaults on EVERY access (`FOR TOKEN 1h`, BEARER `FOR GRANT 4w2d`, `FOR SESSION NONE`); the canonical
  form strips them (coercing the SDK `Duration` objects to strings first) so an access that omits a
  duration doesn't phantom-`OVERWRITE` against the introspected default. A non-default value survives.
  Known gap: durations aren't unit-normalized, so an explicit non-default in a non-canonical unit
  (`"30d"` vs `"4w2d"`, `"60m"` vs `"1h"`) can still churn — author in SurrealDB's spelling.
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
- [x] `DEFINE ANALYZER TOKENIZERS … [FILTERS …]` — `defineAnalyzer(name, { tokenizers, filters? })` (its own kind; a FULLTEXT index `deps` on it)
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
| Tables (schema mode, type, perms, changefeed, comment, drop, relations, views) | `[x]` — full `DEFINE TABLE` head |
| Field types (scalars, geometry, containers, records, literals, unions, tuples, optionality) | `[x]` — range/regex `[ ]`, object-unions/open-maps `[~]` |
| Field clauses (default/value/computed/assert/readonly/comment/flexible/permissions/reference) | `[x]` |
| Indexes (plain, unique, composite, count, COMMENT, vector HNSW/DISKANN, full-text) | `[x]` — full `DEFINE INDEX` (modifiers CONCURRENTLY/DEFER n/a) |
| Analyzers (`DEFINE ANALYZER`) | `[x]` |
| Events | `[x]` — `ASYNC` `[ ]` |
| Functions | `[x]` (body-format caveat) |
| Access/Auth (RECORD) | `[x]` |
| Access/Auth (JWT, BEARER) | `[~]` — secrets redacted |
| DB-level (param/sequence/user/config/api/bucket/model) | `[ ]` |

---

## Kind inventory (core-v2 kind-registry migration)

Tracks the migration of this driver's object kinds onto the `@schemic/core` **kind registry**
(`packages/core/docs/kind-registry-contract.md`). Lists **every** kind SurrealDB has — including ones
not registered yet — so the gaps stay visible. `field` is **substrate nested in `table`**, not a kind.

A kind is `[x]` in a column only when that capability round-trips through the **registry path**
(`KindEngine` on `src/kinds/`), independently of the still-live fixed-slot path.

**Status: FLIPPED (Option-A).** The production `surrealDriver` IS the kind registry — the whole-DB
`lower`/`emit`/`diff`/`introspect`/`normalize`/`equal` methods are GONE, replaced by
`registry`/`explode`/`introspectAll` + the command capabilities. Core orchestrates schema ops
(`lowerSchema`/`buildKindDiff`/`emitKinds`/`orderObjects`) generically over the registry; the Struct-IR
(`DbStructured`) + `diffSnapshots` remain the driver's INTERNAL clause-level engine the kinds delegate
to. Every kind SurrealDB emits — `table`, `index`, `event`, `function`, `access`, `analyzer` — round-trips:
- the kind engines stay byte-exact with the internal `diffSnapshots` engine (`test/unit/kind-parity.test.ts`);
- `introspectAll` live round-trips on SurrealDB 3.1.3 (zero phantom diff, `test/parity/introspect-kinds.test.ts`);
- per-field diff display via the table kind's `displayItems` (Manuel's call — field-level items grouped under their table);
- `renderSchema` reconstructs `DbStructured` from the portable objects (the normalized struct rides on
  them — `PTable.struct` + the opaque kinds' `native`), no DDL re-parse.

Verified green on main: typecheck 0, unit 453 (incl. the reference cookbook), live parity + e2e 19/19 on
SurrealDB 3.1.3 — the real CLI through the generic registry path.

Introspect is via the registry's reverse hook `introspectAll` (one `INFO … STRUCTURE` read fanned per
kind, canonicalized through `structuredSnapshot` like `lower`). Post-flip this **is** the production
introspect path (the fixed-slot `Driver.introspect` is gone), live-validated to round-trip on SurrealDB
3.1.3 (`test/parity/introspect-kinds.test.ts`).

| Kind | Registered | `emit` | `overwrite`/diff | `introspect` | Notes |
|---|---|---|---|---|---|
| `table` (NORMAL/ANY/RELATION) | `[x]` | `[x]` | `[x]` | `[x]` | fields nested; field+head ALTER inside `overwrite` (delegates to `diffSnapshots`); RELATION in/out + `fn::` → `deps` |
| `field` *(substrate, nested in `table`)* | n/a | `[x]` | `[x]` | `[x]` | `PortableField` clauses carried verbatim; **not** its own kind |
| `index` (plain/UNIQUE/composite/COUNT) | `[x]` | `[x]` | `[x]` | `[x]` | own kind; `deps`/`owner` → table; change = recreate (REMOVE + DEFINE) |
| `event` | `[x]` | `[x]` | `[x]` | `[x]` | own kind; `deps`/`owner` → table + `fn::` callees; change = `DEFINE EVENT OVERWRITE` |
| `function` (`fn::`) | `[x]` | `[x]` | `[x]` | `[x]` | opaque kind; `deps` = other `fn::` it calls; change = `DEFINE FUNCTION OVERWRITE` |
| `access` (RECORD/JWT/BEARER) | `[x]` | `[x]` | `[x]` | `[~]` | opaque kind; `deps` = `fn::` in SIGNUP/SIGNIN/AUTHENTICATE; change = `DEFINE ACCESS OVERWRITE`; introspect partial (JWT/BEARER secrets redacted, as on the legacy path) |
| `analyzer` (`DEFINE ANALYZER`) | `[x]` | `[x]` | `[x]` | `[x]` | own kind; a FULLTEXT `index` `deps` on it (analyzer emits first); tokenizers/filters uppercased; default BM25 stripped → round-trips |
| `param` (`DEFINE PARAM`) | `[ ]` | `[ ]` | `[ ]` | `[ ]` | not yet in the driver at all |
| `user` (`DEFINE USER`) | `[ ]` | `[ ]` | `[ ]` | `[ ]` | not yet in the driver |
| `model` (`DEFINE MODEL`) | `[ ]` | `[ ]` | `[ ]` | `[ ]` | not yet in the driver |
| `config` (`DEFINE CONFIG GRAPHQL/API`) | `[ ]` | `[ ]` | `[ ]` | `[ ]` | 3.x; not yet in the driver |
| `api` / `bucket` (3.x) | `[ ]` | `[ ]` | `[ ]` | `[ ]` | not yet in the driver |

**`natives`: N/A.** SurrealDB emits no `PortableNative` objects — the db-level long-tail
(`param`/`user`/`model`/`config`/`api`/`bucket`) isn't implemented in the driver yet (`analyzer` now is —
see above), and `function`/`access` are their own kinds (above), not natives. So there is nothing in the
`natives` slot to migrate; it's listed here only so the gap stays visible.

**`fn::` dependency edges (done).** Field `VALUE`/`ASSERT`/`DEFAULT`/`COMPUTED`/`PERMISSIONS`, table
`PERMISSIONS`, event `WHEN`/`THEN`, and access `SIGNUP`/`SIGNIN`/`AUTHENTICATE` are scanned for `fn::`
references; each becomes a `deps → {kind:"function"}` so a called function emits **before** its caller
(the function-before-table case the ordinal alone gets wrong). Asserted in the parity suite.

**SEARCH `index` → `analyzer` edges (done).** A FULLTEXT `index` `deps` on the `analyzer` it names, so
the analyzer emits **before** the index; live-validated in `test/parity/define-index.test.ts`. The
display-granularity decision shipped as per-field `items` grouped under their table (the table kind's
`displayItems`).
