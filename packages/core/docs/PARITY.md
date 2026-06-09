# surreal-zod ↔ SurrealDB Schema/DDL Parity Report

> Audit of the surreal-zod **schema / DDL layer** (`sz.*`, `defineTable`/`defineRelation`/
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
`DEFINE FUNCTION`, and `DEFINE ACCESS` statement that surreal-zod generates for a broad
mixed-type table (60 fields covering scalars, native types, records, collections, literals,
unions, nested objects, FLEXIBLE, and every field clause) was **accepted by SurrealDB 3.1.3
with ZERO rejections**, and the core types round-trip faithfully through `INFO … STRUCTURE`.

**No live rejections / real bugs were found** — surreal-zod never emits DDL the DB refuses.
The gaps below are missing *expressiveness*, not broken output.

The optionality model is also correct: `option<T>` is emitted, the DB desugars it to
`none | T` (equivalent), and `.optional().nullable()`/`.nullish()` fold to
`option<T | null>`. A DB-side `DEFAULT`/`VALUE`/`COMPUTED` correctly strips a leading
`option<>` (the column is always populated). `option<any>` is suppressed (invalid SurQL).

### ✅ Recently closed — batch 1

Four gaps from this audit are now supported, each live-verified round-trip
(sync/diff/pull) on SurrealDB 3.1.3:

```ts
// set<T> — distinct dedup collection (was lossy → array<T>; pull reverses set<T> → sz.set(...))
sz.set(sz.string())
//→ DEFINE FIELD tags ON TABLE t TYPE set<string>;

// COMPUTED — a derived, read-only / create-optional column
sz.string().$computed(surql`string::concat(first, " ", last)`)
//→ DEFINE FIELD full ON TABLE person TYPE string COMPUTED string::concat(first, ' ', last);

// CHANGEFEED — per-table change tracking, folded into the DEFINE TABLE head
defineTable("reading", { /* … */ }).changefeed("3d", { includeOriginal: true })
//→ DEFINE TABLE reading TYPE NORMAL SCHEMAFULL CHANGEFEED 3d INCLUDE ORIGINAL;

// COUNT — materialized row-count index (no FIELDS clause)
defineTable("t", { /* … */ }).index("t_count", [], { count: true })
//→ DEFINE INDEX t_count ON TABLE t COUNT;
```

### Prioritized schema-layer gaps that SHOULD be closed (ranked by value)

1. **Record references — `REFERENCE [ON DELETE …]`** (❌, high value).
   2.x+ referential integrity. The DB accepts it; surreal-zod has no builder.
   SurQL needed:
   ```surql
   DEFINE FIELD author ON comment TYPE record<person> REFERENCE ON DELETE CASCADE;
   DEFINE FIELD friends ON person TYPE option<array<record<person>>> REFERENCE ON DELETE UNSET;
   ```
   Suggested API: `sz.recordId("person").reference({ onDelete: "cascade" })`.

2. **Full-text search + analyzers** (❌, high value for search apps).
   `DEFINE ANALYZER` (prerequisite) and `DEFINE INDEX … FULLTEXT ANALYZER … BM25 HIGHLIGHTS`.
   ```surql
   DEFINE ANALYZER ascii TOKENIZERS class FILTERS lowercase, ascii;
   DEFINE INDEX nameIdx ON TABLE user FIELDS name FULLTEXT ANALYZER ascii BM25 HIGHLIGHTS;
   ```

3. **Vector indexes — HNSW / MTREE / DISKANN** (❌, high value for AI/RAG).
   ```surql
   DEFINE INDEX emb ON document FIELDS embedding HNSW DIMENSION 768 DIST COSINE TYPE F32;
   ```

4. **`TYPE RELATION … ENFORCED`** (❌, medium). Enforce endpoint existence on RELATE.
   `defineRelation(...).from(A).to(B)` should support an `.enforced()` toggle.

5. **Object-literal unions** (⚠️ lossy, medium). A discriminated/object union collapses to
   plain `object`, losing per-branch structure. The DB accepts:
   ```surql
   DEFINE FIELD r ON t TYPE { kind: "a", x: string } | { kind: "b", y: number };
   ```

6. **`array<T, N>` / `set<T, N>` max-size param** (❌, low). No API.
   `DEFINE FIELD pts ON t TYPE array<float, 3>;`

7. **Computed / view tables — `AS SELECT … FROM …`** (❌, low; arguably ORM scope).

8. **Other `DEFINE` objects**: `PARAM`, `USER`, `SEQUENCE`, `CONFIG`, `API`, `BUCKET`,
   `MODEL`, `NAMESPACE`, `DATABASE` (❌). Mostly out of the per-table schema-author scope,
   but `DEFINE PARAM` and `DEFINE SEQUENCE` are reasonable near-term additions.

> **Closed in batch 1** (`b76269d`): `set<T>`, `COMPUTED`, `CHANGEFEED`, `COUNT` index — see
> the examples above and the ✅ matrix rows below.

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
  subfields), `set<T>` (dedup, batch 1), open-keyed `record`/`map` (`.* ` value field),
  deep nesting, intersection merge, `FLEXIBLE`.
- **Field clauses**: `DEFAULT` (+ `ALWAYS`), `VALUE`, `COMPUTED` (`.$computed(surql\`…\`)` —
  batch 1), `ASSERT` (custom surql + derived from `$min/$max/$length/$regex/$gt/$gte/$lt/$lte`,
  AND-combined), `READONLY`, `COMMENT`, per-op `PERMISSIONS` (incl. `same as`),
  `$internal()` → `PERMISSIONS NONE`.
- **String formats**: `string::is_email/url/ipv4/ipv6/ulid` baked as ASSERT (validated to
  exist on 3.1.3); non-bakeable formats (jwt/cuid/nanoid/base64/…) stay assert-free.
- **Table clauses**: `TYPE NORMAL/ANY/RELATION` (with `FROM`/`TO`), `SCHEMAFULL`/`SCHEMALESS`,
  `DROP`, `COMMENT`, table-level `PERMISSIONS`, `CHANGEFEED` (batch 1), `OVERWRITE` / `IF NOT EXISTS`.
- **Indexes**: single-field `.index()`/`.unique()`, composite `.index(name, fields, {unique})`,
  `COUNT` (`.index(name, [], { count: true })` — batch 1).
- **DEFINE statements**: `EVENT` (WHEN/THEN, multi-then), `FUNCTION` (args/returns/body/
  permissions/comment), `ACCESS` (RECORD signup/signin/authenticate + DURATION, JWT
  alg/key/url, BEARER for record/user).

---

## Feature-by-feature matrix

### Types (`sz.*` → DDL `TYPE`)

| Feature | SurQL `TYPE` | surreal-zod | Status | Notes |
|---|---|---|---|---|
| string | `string` | `sz.string()` | ✅ | |
| bool | `bool` | `sz.boolean()` | ✅ | |
| null | `null` | `sz.null()` | ✅ | |
| any | `any` | `sz.any()` / `sz.unknown()` | ✅ | |
| number (generic) | `number` | `sz.number()` | ✅ | |
| int | `int` | `sz.int()` / `int32()` / `uint32()` / `bigint()` | ✅ | format-discriminated |
| float | `float` | `sz.float()` | ✅ | |
| decimal | `decimal` | `sz.decimal()` | ✅ | `Decimal` instance |
| datetime | `datetime` | `sz.datetime()` / `sz.date()` | ✅ | codec ↔ JS `Date` |
| duration | `duration` | `sz.duration()` | ✅ | `Duration` instance |
| bytes | `bytes` | `sz.bytes()` | ✅ | codec ↔ `Uint8Array` |
| uuid | `uuid` | `sz.uuid()` | ✅ | codec ↔ string |
| file | `file` | `sz.file()` | ✅ | `FileRef` |
| geometry | `geometry` | `sz.geometry()` | ✅ | |
| geometry kinds | `geometry<point\|line\|polygon\|multipoint\|multiline\|multipolygon\|collection>` | `sz.geometry(kind)` | ✅ | all 7 validated live |
| record link | `record<t>` / `record<a\|b>` | `sz.recordId(t)` / `sz.recordId([a,b])` | ✅ | |
| array of record | `array<record<t>>` | `sz.array(sz.recordId(t))` | ✅ | |
| literal scalar | `"admin"` / `42` | `sz.literal(v)` | ✅ | |
| enum | `"a" \| "b"` | `sz.enum([...])` / `sz.nativeEnum({...})` | ✅ | numeric enums too |
| scalar union | `string \| number` | `sz.union([...])` | ✅ | |
| tuple | `[string, number]` | `sz.tuple([...])` | ✅ | variadic → generic `array` |
| array | `array<T>` | `sz.array(x)` | ✅ | |
| object (nested) | `object` + `f.k` subfields | `sz.object({...})` | ✅ | |
| array of object | `array<object>` + `f.*.k` | `sz.array(sz.object({...}))` | ✅ | |
| open record/map | `object` + `f.*` | `sz.record(k,v)` / `sz.map(k,v)` | ✅ | |
| FLEXIBLE object | `object FLEXIBLE` | `sz.object({...}).flexible()` | ✅ | |
| intersection | merged `object` | `sz.intersection(a,b)` | ✅ | right wins on overlap |
| optional | `option<T>` | `.optional()` | ✅ | DB shows `none \| T` |
| nullable | `T \| null` | `.nullable()` | ✅ | |
| nullish | `option<T \| null>` | `.nullish()` | ✅ | folds correctly |
| string formats (bakeable) | `string ASSERT string::is_*($value)` | `sz.email()/url()/ipv4()/ipv6()/ulid()` | ✅ | validators confirmed on 3.1.3 |
| string formats (other) | `string` | `sz.jwt()/cuid()/nanoid()/base64()/…` | ✅ | no fabricated regex |
| set (dedup) | `set<T>` | `sz.set(x)` | ✅ | batch 1 — emits `set<T>`, round-trips (was lossy → `array`) |
| **object-literal union** | `{a:..}\|{b:..}` | `sz.discriminatedUnion(...)` → `object` | ⚠️ | per-branch structure lost |
| **range** | `range` | — | ❌ | no `sz.range()` (bare `range` is a valid field type) |
| **regex** | `regex` | — | ❌ | no `sz.regexType()` |
| **array/set max-size** | `array<T,N>` / `set<T,N>` | — | ❌ | no size param |

### DEFINE statements

| Statement | surreal-zod | Status | Notes |
|---|---|---|---|
| DEFINE TABLE | `defineTable` / `defineRelation` | ✅ | |
| DEFINE FIELD | shape fields (`sz.*` + `$`-clauses) | ✅ | |
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

| Clause | SurQL | surreal-zod | Status |
|---|---|---|---|
| TYPE NORMAL | `TYPE NORMAL` | default | ✅ |
| TYPE ANY | `TYPE ANY` | `.typeAny()` | ✅ |
| TYPE RELATION (FROM/TO) | `TYPE RELATION FROM a TO b` | `defineRelation(...).from(A).to(B)` | ✅ |
| TYPE RELATION (open) | `TYPE RELATION` | `defineRelation(...)` | ✅ |
| **RELATION … ENFORCED** | `TYPE RELATION … ENFORCED` | — | ❌ |
| SCHEMAFULL/SCHEMALESS | both | `.schemafull()` / `.schemaless()` | ✅ |
| DROP | `DROP` | `.drop()` | ✅ |
| COMMENT | `COMMENT "…"` | `.comment(...)` | ✅ |
| PERMISSIONS | `PERMISSIONS FOR … [FULL\|NONE\|WHERE]` | `.permissions(...)` | ✅ |
| OVERWRITE / IF NOT EXISTS | both | `{ exists: "overwrite" \| "ignore" }` | ✅ |
| CHANGEFEED | `CHANGEFEED 1d [INCLUDE ORIGINAL]` | `.changefeed("1d", { includeOriginal })` | ✅ batch 1 |
| **AS SELECT (view)** | `AS SELECT … FROM …` | — | ❌ |

### Field clauses

| Clause | SurQL | surreal-zod | Status |
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
| **REFERENCE / ON DELETE** | `REFERENCE [ON DELETE CASCADE\|REJECT\|IGNORE\|UNSET\|THEN …]` | — | ❌ |

### Indexes

| Kind | SurQL | surreal-zod | Status |
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

These are query/runtime features, intentionally not expressed via `sz.*` DDL:

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
  `sz.set()` to emit `set<T>` and pull to reverse it back to `sz.set(...)`.
- **`string::is_*` validators** for email/url/ipv4/ipv6/ulid (and uuid/datetime) all exist on
  3.1.3 — the baked asserts are correct. (3.x uses the underscore form, e.g. `string::is_email`.)
- **`range<int>` is invalid DDL** — only bare `range` is a field type. `references` /
  `references<table>` are also NOT field types on 3.1.3 (back-references are the `<~` /
  `COMPUTED` query path), so they are correctly absent from the type matrix.
- **Geometry**: bare `point`/`line`/etc. are NOT valid bare field types (only `point` is);
  surreal-zod correctly emits `geometry<kind>`, which is accepted for all 7 kinds.

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
