# @schemic/core ↔ SurrealDB Schema/DDL Parity Report

> Audit of the @schemic/core **schema / DDL layer** (`s.*`, `defineTable`/`defineRelation`/
> `defineEvent`/`defineFunction`/`defineAccess`, `emitTable`/`emitStatements`/`emitField`/
> `emitDefStatement`) against SurrealDB's full feature set and the SurrealQL `DEFINE`
> language. Source of truth: the official docs (URLs at the bottom). Live verification:
> **SurrealDB 3.1.3** over `ws://localhost:8000`, JS SDK `surrealdb` 2.0.3, Zod `^4`. Every
> generated statement was applied to a throwaway `__sz_parity` namespace and introspected
> via `INFO FOR TABLE … STRUCTURE`; that namespace was dropped on completion.
>
> Legend: ✅ Supported · ⚠️ Partial / lossy · ❌ Gap

---

## Executive summary

**Overall read: the schema layer has strong, correct parity for everyday SurrealDB
modeling.** Every `DEFINE TABLE`, `DEFINE FIELD`, `DEFINE INDEX`, `DEFINE EVENT`,
`DEFINE FUNCTION`, and `DEFINE ACCESS` statement that @schemic/core generates for a broad
mixed-type table (60 fields covering scalars, native types, records, collections, literals,
unions, nested objects, FLEXIBLE, and every field clause) was **accepted by SurrealDB 3.1.3
with ZERO rejections**, and the core types round-trip faithfully through `INFO … STRUCTURE`.

**No live rejections / real bugs were found** — @schemic/core never emits DDL the DB refuses.
The gaps below are missing *expressiveness*, not broken output.

The optionality model is also correct: `option<T>` is emitted, the DB desugars it to
`none | T` (equivalent), and `.optional().nullable()`/`.nullish()` fold to
`option<T | null>`. A DB-side `DEFAULT`/`VALUE`/`COMPUTED` correctly strips a leading
`option<>` (the column is always populated). `option<any>` is suppressed (invalid SurQL).

### ✅ Recently closed — batch 1

Four gaps from this audit are now supported, each live-verified round-trip
(sync/diff/pull) on SurrealDB 3.1.3:

```ts
// set<T> — distinct dedup collection (was lossy → array<T>; pull reverses set<T> → s.set(...))
s.set(s.string())
//→ DEFINE FIELD tags ON TABLE t TYPE set<string>;

// COMPUTED — a derived, read-only / create-optional column
s.string().$computed(surql`string::concat(first, " ", last)`)
//→ DEFINE FIELD full ON TABLE person TYPE string COMPUTED string::concat(first, ' ', last);

// CHANGEFEED — per-table change tracking, folded into the DEFINE TABLE head
defineTable("reading", { /* … */ }).changefeed("3d", { includeOriginal: true })
//→ DEFINE TABLE reading TYPE NORMAL SCHEMAFULL CHANGEFEED 3d INCLUDE ORIGINAL;

// COUNT — materialized row-count index (no FIELDS clause)
defineTable("t", { /* … */ }).index("t_count", [], { count: true })
//→ DEFINE INDEX t_count ON TABLE t COUNT;
```

### ✅ Recently closed — batch 2

Four more gaps closed — DDL-asserted in `ddl-parity.test.ts` **and live round-trip verified on
SurrealDB 3.1.3** (`live-parity.test.ts`):

```ts
// Record REFERENCE [ON DELETE …] — referential integrity on links
s.recordId("person").reference({ onDelete: "cascade" })
//→ DEFINE FIELD author ON TABLE comment TYPE record<person> REFERENCE ON DELETE CASCADE;

// TYPE RELATION … ENFORCED — require both endpoints on RELATE
defineRelation("liked").from(User).to(Post).enforced()
//→ DEFINE TABLE liked TYPE RELATION FROM user TO post ENFORCED SCHEMAFULL;

// Sized array<T,N> / set<T,N> — N is the MAX size (maps to Zod .max(); set stays set)
s.array(s.string(), { max: 5 })
//→ DEFINE FIELD tags ON TABLE t TYPE array<string, 5>;

// +10 string::is_* validators (no Zod format builder; string + DB ASSERT)
s.alpha() / s.alphanum() / s.ascii() / s.numeric() / s.semver() /
s.hexadecimal() / s.latitude() / s.longitude() / s.ip() / s.domain()
//→ DEFINE FIELD f ON TABLE t TYPE string ASSERT string::is_<name>($value);
```

### Prioritized schema-layer gaps that SHOULD be closed (ranked by value)

1. **Full-text search + analyzers** (❌, high value for search apps).
   `DEFINE ANALYZER` (prerequisite) and `DEFINE INDEX … FULLTEXT ANALYZER … BM25 HIGHLIGHTS`.
   ```surql
   DEFINE ANALYZER ascii TOKENIZERS class FILTERS lowercase, ascii;
   DEFINE INDEX nameIdx ON TABLE user FIELDS name FULLTEXT ANALYZER ascii BM25 HIGHLIGHTS;
   ```

2. **Vector indexes — HNSW / DISKANN** (❌, high value for AI/RAG).
   ```surql
   DEFINE INDEX emb ON document FIELDS embedding HNSW DIMENSION 768 DIST COSINE TYPE F32;
   ```

3. **Object-literal unions** (⚠️ lossy, medium). A discriminated/object union collapses to
   plain `object`, losing per-branch structure. The DB accepts:
   ```surql
   DEFINE FIELD r ON t TYPE { kind: "a", x: string } | { kind: "b", y: number };
   ```

4. **Event `ASYNC [RETRY n] [MAXDEPTH n]` + `COMMENT`** (❌, medium). `defineEvent`/`.event()`
   emit only `WHEN`/`THEN`.

5. **`range` / `regex` bare types** (❌, low). No `s.range()` / `s.regex()`.

6. **Computed / view tables — `AS SELECT … FROM …`** (❌, low; arguably ORM scope).

7. **RECORD access `WITH JWT` / `WITH ISSUER`** (❌, medium). Cannot pin a RECORD access's
   own JWT signing config.

8. **Other `DEFINE` objects**: `PARAM`, `SEQUENCE` (reasonable near-term), plus `USER`,
   `CONFIG`, `API`, `BUCKET`, `MODEL`, `MODULE`, `NAMESPACE`, `DATABASE … STRICT` (mostly
   out of the per-table schema-author scope).

> **Closed in batch 1** (`b76269d`): `set<T>`, `COMPUTED`, `CHANGEFEED`, `COUNT` index.
> **Closed in batch 2**: record `REFERENCE [ON DELETE …]`, `RELATION … ENFORCED`, sized
> `array<T,N>` / `set<T,N>`, +10 `string::is_*` validators — see the ✅ matrix rows below.

### What is solidly covered (✅)

- **Scalars**: `string`, `bool`, `null`, `any`, `number`, `int` (int/int32/uint32/bigint),
  `float`, `decimal`.
- **Native types**: `datetime`, `duration`, `bytes`, `uuid`, `file`, `geometry` + all 7
  `geometry<kind>` (point/line/polygon/multipoint/multiline/multipolygon/collection — every
  kind validated live).
- **Record links**: `record<t>`, `record<a | b>`, `array<record<t>>`, self-referential
  (`self.optional()` → `option<record<thisTable>>`), id-value typing.
- **Literals / enums / unions / tuples**: literal scalars, `enum`, `nativeEnum`
  (string + numeric), scalar unions, `[a, b]` tuples.
- **Collections**: nested `object` (path-qualified subfields), arrays of objects (`.*`
  subfields), `set<T>` (dedup, batch 1), sized `array<T,N>`/`set<T,N>` (batch 2), open-keyed `record`/`map` (`.* ` value field),
  deep nesting, intersection merge, `FLEXIBLE`.
- **Field clauses**: `DEFAULT` (+ `ALWAYS`), `VALUE`, `COMPUTED` (`.$computed(surql\`…\`)` —
  batch 1), `REFERENCE [ON DELETE …]` (`.reference({ onDelete })` — batch 2), `ASSERT` (custom surql + derived from `$min/$max/$length/$regex/$gt/$gte/$lt/$lte`,
  AND-combined), `READONLY`, `COMMENT`, per-op `PERMISSIONS` (incl. `same as`),
  `$internal()` → `PERMISSIONS NONE`.
- **String formats**: `string::is_email/url/ipv4/ipv6/ulid` + batch 2 `alpha/alphanum/ascii/numeric/semver/hexadecimal/latitude/longitude/ip/domain` baked as ASSERT (validated to
  exist on 3.1.3); non-bakeable formats (jwt/cuid/nanoid/base64/…) stay assert-free.
- **Table clauses**: `TYPE NORMAL/ANY/RELATION` (with `FROM`/`TO`, `ENFORCED` — batch 2), `SCHEMAFULL`/`SCHEMALESS`,
  `DROP`, `COMMENT`, table-level `PERMISSIONS`, `CHANGEFEED` (batch 1), `OVERWRITE` / `IF NOT EXISTS`.
- **Indexes**: single-field `.index()`/`.unique()`, composite `.index(name, fields, {unique})`,
  `COUNT` (`.index(name, [], { count: true })` — batch 1).
- **DEFINE statements**: `EVENT` (WHEN/THEN, multi-then), `FUNCTION` (args/returns/body/
  permissions/comment), `ACCESS` (RECORD signup/signin/authenticate + DURATION, JWT
  alg/key/url, BEARER for record/user).

---

## Feature-by-feature matrix

### Types (`s.*` → DDL `TYPE`)

| Feature | SurQL `TYPE` | @schemic/core | Status | Notes |
|---|---|---|---|---|
| string | `string` | `s.string()` | ✅ | |
| bool | `bool` | `s.boolean()` | ✅ | |
| null | `null` | `s.null()` | ✅ | |
| any | `any` | `s.any()` / `s.unknown()` | ✅ | |
| number (generic) | `number` | `s.number()` | ✅ | |
| int | `int` | `s.int()` / `int32()` / `uint32()` / `bigint()` | ✅ | format-discriminated |
| float | `float` | `s.float()` | ✅ | |
| decimal | `decimal` | `s.decimal()` | ✅ | `Decimal` instance |
| datetime | `datetime` | `s.datetime()` / `s.date()` | ✅ | codec ↔ JS `Date` |
| duration | `duration` | `s.duration()` | ✅ | `Duration` instance |
| bytes | `bytes` | `s.bytes()` | ✅ | codec ↔ `Uint8Array` |
| uuid | `uuid` | `s.uuid()` | ✅ | codec ↔ string |
| file | `file` | `s.file()` | ✅ | `FileRef` |
| geometry | `geometry` | `s.geometry()` | ✅ | |
| geometry kinds | `geometry<point\|line\|polygon\|multipoint\|multiline\|multipolygon\|collection>` | `s.geometry(kind)` | ✅ | all 7 validated live |
| record link | `record<t>` / `record<a\|b>` | `s.recordId(t)` / `s.recordId([a,b])` | ✅ | |
| array of record | `array<record<t>>` | `s.array(s.recordId(t))` | ✅ | |
| literal scalar | `"admin"` / `42` | `s.literal(v)` | ✅ | |
| enum | `"a" \| "b"` | `s.enum([...])` / `s.nativeEnum({...})` | ✅ | numeric enums too |
| scalar union | `string \| number` | `s.union([...])` | ✅ | |
| tuple | `[string, number]` | `s.tuple([...])` | ✅ | variadic → generic `array` |
| array | `array<T>` | `s.array(x)` | ✅ | |
| object (nested) | `object` + `f.k` subfields | `s.object({...})` | ✅ | |
| array of object | `array<object>` + `f.*.k` | `s.array(s.object({...}))` | ✅ | |
| open record/map | `object` + `f.*` | `s.record(k,v)` / `s.map(k,v)` | ✅ | |
| FLEXIBLE object | `object FLEXIBLE` | `s.object({...}).flexible()` | ✅ | |
| intersection | merged `object` | `s.intersection(a,b)` | ✅ | right wins on overlap |
| optional | `option<T>` | `.optional()` | ✅ | DB shows `none \| T` |
| nullable | `T \| null` | `.nullable()` | ✅ | |
| nullish | `option<T \| null>` | `.nullish()` | ✅ | folds correctly |
| string formats (bakeable) | `string ASSERT string::is_*($value)` | `s.email()/url()/ipv4()/ipv6()/ulid()` + batch 2: `alpha/alphanum/ascii/numeric/semver/hexadecimal/latitude/longitude/ip/domain` | ✅ | validators confirmed on 3.1.3 |
| string formats (other) | `string` | `s.jwt()/cuid()/nanoid()/base64()/…` | ✅ | no fabricated regex |
| set (dedup) | `set<T>` | `s.set(x)` | ✅ | batch 1 — emits `set<T>`, round-trips (was lossy → `array`) |
| **object-literal union** | `{a:..}\|{b:..}` | `s.discriminatedUnion(...)` → `object` | ⚠️ | per-branch structure lost |
| **range** | `range` | — | ❌ | no `s.range()` (bare `range` is a valid field type) |
| **regex** | `regex` | — | ❌ | no `s.regexType()` |
| array/set max-size | `array<T,N>` / `set<T,N>` | `s.array(x,{max:N})` / `s.set(x,{max:N})` | ✅ batch 2 | N = MAX size |

### DEFINE statements

| Statement | @schemic/core | Status | Notes |
|---|---|---|---|
| DEFINE TABLE | `defineTable` / `defineRelation` | ✅ | |
| DEFINE FIELD | shape fields (`s.*` + `$`-clauses) | ✅ | |
| DEFINE INDEX | `.index()` / `.unique()` / `.index(name,fields,{unique\|count})` | ✅ (plain/unique/composite/count) | search & vector kinds ❌ |
| DEFINE EVENT | `.event(...)` / `defineEvent(...)` | ✅ | WHEN/THEN, multi-then |
| DEFINE FUNCTION | `defineFunction(...)` | ✅ | args/returns/body/permissions/comment |
| DEFINE ACCESS | `defineAccess(...)` | ✅ | RECORD / JWT / BEARER (+DURATION) |
| DEFINE ANALYZER | — | ❌ | needed to back FULLTEXT indexes |
| DEFINE PARAM | — | ❌ | `DEFINE PARAM $x VALUE …` |
| DEFINE USER | — | ❌ | likely admin/CLI scope |
| DEFINE SEQUENCE | — | ❌ | monotonic ids |
| DEFINE CONFIG | — | ❌ | |
| DEFINE API | — | ❌ | |
| DEFINE BUCKET | — | ❌ | object storage |
| DEFINE MODEL | — | ❌ | SurrealML |
| DEFINE NAMESPACE / DATABASE | — | ❌ | the CLI manages these via env, not the schema layer |

### Table clauses

| Clause | SurQL | @schemic/core | Status |
|---|---|---|---|
| TYPE NORMAL | `TYPE NORMAL` | default | ✅ |
| TYPE ANY | `TYPE ANY` | `.typeAny()` | ✅ |
| TYPE RELATION (FROM/TO) | `TYPE RELATION FROM a TO b` | `defineRelation(...).from(A).to(B)` | ✅ |
| TYPE RELATION (open) | `TYPE RELATION` | `defineRelation(...)` | ✅ |
| RELATION … ENFORCED | `TYPE RELATION … ENFORCED` | `defineRelation(...).enforced()` | ✅ batch 2 |
| SCHEMAFULL/SCHEMALESS | both | `.schemafull()` / `.schemaless()` | ✅ |
| DROP | `DROP` | `.drop()` | ✅ |
| COMMENT | `COMMENT "…"` | `.comment(...)` | ✅ |
| PERMISSIONS | `PERMISSIONS FOR … [FULL\|NONE\|WHERE]` | `.permissions(...)` | ✅ |
| OVERWRITE / IF NOT EXISTS | both | `{ exists: "overwrite" \| "ignore" }` | ✅ |
| CHANGEFEED | `CHANGEFEED 1d [INCLUDE ORIGINAL]` | `.changefeed("1d", { includeOriginal })` | ✅ batch 1 |
| **AS SELECT (view)** | `AS SELECT … FROM …` | — | ❌ |

### Field clauses

| Clause | SurQL | @schemic/core | Status |
|---|---|---|---|
| TYPE | `TYPE <type>` | inferred from schema | ✅ |
| FLEXIBLE | `TYPE object FLEXIBLE` | `.flexible()` / `.loose()` | ✅ |
| DEFAULT | `DEFAULT <expr>` | `.$default(v\|surql)` | ✅ |
| DEFAULT ALWAYS | `DEFAULT ALWAYS <expr>` | `.$defaultAlways(...)` | ✅ |
| VALUE | `VALUE <expr>` | `.$value(surql, {optional?})` | ✅ |
| ASSERT | `ASSERT <expr>` | `.$assert(surql)` / `.$assert()` (derived) / `$min/$max/…` | ✅ |
| READONLY | `READONLY` | `.$readonly()` | ✅ |
| COMMENT | `COMMENT "…"` | `.$comment(...)` | ✅ |
| PERMISSIONS | `PERMISSIONS FOR select/create/update …` | `.$permissions(...)` (+ `same as`) | ✅ |
| internal (hidden) | `PERMISSIONS NONE` | `.$internal()` | ✅ |
| COMPUTED | `COMPUTED <expr>` | `.$computed(surql`…`)` | ✅ batch 1 |
| REFERENCE / ON DELETE | `REFERENCE [ON DELETE CASCADE\|REJECT\|IGNORE\|UNSET\|THEN …]` | `.reference({ onDelete })` | ✅ batch 2 |

### Indexes

| Kind | SurQL | @schemic/core | Status |
|---|---|---|---|
| plain (single) | `… FIELDS f` | `.index()` | ✅ |
| UNIQUE (single) | `… FIELDS f UNIQUE` | `.unique()` | ✅ |
| composite | `… FIELDS a, b [UNIQUE]` | `.index(name, [a,b], {unique})` | ✅ |
| **FULLTEXT / SEARCH** | `… FULLTEXT ANALYZER x BM25 HIGHLIGHTS` | — | ❌ |
| **HNSW (vector)** | `… HNSW DIMENSION n DIST … TYPE …` | — | ❌ |
| **MTREE (vector)** | `… MTREE DIMENSION n` | — | ❌ |
| **DISKANN (vector, 3.1+)** | `… DISKANN DIMENSION n …` | — | ❌ |
| COUNT | `… COUNT` | `.index(name, [], { count: true })` | ✅ batch 1 |
| **CONCURRENTLY / DEFER** | modifiers | — | ❌ |

---

## Out-of-scope inventory (FUTURE ORM / query-builder — NOT the schema layer)

These are query/runtime features, intentionally not expressed via `s.*` DDL:

- **DML / queries**: `SELECT`, `INSERT`, `CREATE`, `UPDATE`, `UPSERT`, `DELETE`, `RELATE`,
  `MERGE`/`PATCH`, `RETURN`, `LET`, `BEGIN`/`COMMIT`/`CANCEL` transactions.
- **Graph traversal**: `->edge->table`, `<-edge<-`, `.{}` destructuring, recursive paths.
- **Record references at query time**: `<~table`, `.refs()` back-reference fetching, the
  `COMPUTED <~(…)` view field (DDL side noted as a gap above).
- **Built-in function libraries**: `string::`, `math::`, `time::`, `array::`, `object::`,
  `crypto::`, `rand::`, `vector::`, `geo::`, `type::`, `http::`, `search::`, `session::`, etc.
- **Operators**: `?:`, `??`, `CONTAINS`, `INSIDE`, `@@` (matches), `<|k|>` (knn), ranges
  (`id:1..10`), idioms.
- **LIVE queries** (`LIVE SELECT`), **futures** (`<future>{ … }`), **closures**
  (`|$x| { … }`) as runtime values, **parameters** (`$auth`, `$session`, `$value`, …).
- **Admin**: `INFO FOR …`, `SHOW CHANGES`, `REBUILD INDEX`, `USE`, `KILL`, import/export.

(Several of these — `INFO FOR … STRUCTURE`, `REMOVE …`, idempotent re-define — are already
used internally by the CLI/migration layer, but are not part of the authoring surface.)

---

## Notes / observations

- **No live rejections.** A 60-field mixed-type table + relations + event + function +
  3 access kinds all applied to SurrealDB 3.1.3 with zero errors.
- **`option<T>` ↔ `none | T`**: the DB reports `option<string>` as `none | string` in
  `INFO … STRUCTURE`. Equivalent; just a canonicalization the migration diff already handles.
- **`set<T>` is real and distinct** on 3.1.3 (not normalized to `array`). Batch 1 fixed
  `s.set()` to emit `set<T>` and pull to reverse it back to `s.set(...)`.
- **`string::is_*` validators** for email/url/ipv4/ipv6/ulid (and batch 2:
  alpha/alphanum/ascii/numeric/semver/hexadecimal/latitude/longitude/ip/domain) all exist on
  3.1.3 — the baked asserts are correct. (3.x uses the underscore form, e.g. `string::is_email`.)
- **`range<int>` is invalid DDL** — only bare `range` is a field type. `references` /
  `references<table>` are also NOT field types on 3.1.3 (back-references are the `<~` /
  `COMPUTED` query path), so they are correctly absent from the type matrix.
- **Geometry**: bare `point`/`line`/etc. are NOT valid bare field types (only `point` is);
  @schemic/core correctly emits `geometry<kind>`, which is accepted for all 7 kinds.

---

## Docs used (source of truth)

- https://surrealdb.com/docs/surrealql/datamodel
- https://surrealdb.com/docs/surrealql/datamodel/records
- https://surrealdb.com/docs/surrealql/datamodel/references
- https://surrealdb.com/docs/surrealql/datamodel/literals
- https://surrealdb.com/docs/surrealql/datamodel/geometries
- https://surrealdb.com/docs/surrealql/statements/define
- https://surrealdb.com/docs/surrealql/statements/define/table
- https://surrealdb.com/docs/surrealql/statements/define/field
- https://surrealdb.com/docs/surrealql/statements/define/indexes
- https://surrealdb.com/docs/surrealql/statements/define/analyzer
- https://surrealdb.com/docs/surrealql/statements/define/param

## Reproducing

- DDL assertions (no DB): `bun test test/parity/ddl-parity.test.ts`
- Live round-trip (scratch `__sz_parity` ns, auto-skips with no DB):
  `SURREAL_PASS=… bun test test/parity/live-parity.test.ts`
- Both: `bun test test/parity/` (todos = documented gaps; they do not fail the suite).
