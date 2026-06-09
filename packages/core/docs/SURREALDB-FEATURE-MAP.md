# SurrealDB / SurrealQL Complete Feature Map ↔ surreal-zod parity

> **Deep crawl** of the *entire* SurrealDB documentation site (709-page sitemap, the
> `docs/reference/query-language/**` reference exhaustively), cataloging **every** data type,
> statement, clause, index kind, function (all 26 namespaces, ~570 signatures), operator,
> parameter, and primitive — then assessing surreal-zod's **schema/DDL layer** parity against
> the schema-relevant subset.
>
> This supersedes the shallower `PARITY.md` (which hit only the main `DEFINE` pages and skipped
> the function/operator reference libraries entirely). Everything in `PARITY.md` is folded in
> here; **what this deep crawl found beyond it is flagged with 🆕**.
>
> Crawl method: Chrome DevTools MCP (real browser) + same-origin `fetch()` for token-efficient
> structured DOM extraction. Live verification: **SurrealDB 3.1.3** (`surreal sql` CLI), scratch
> namespace `__sz_map`, dropped on completion. SDK `surrealdb` 2.0.3. Today: 2026-06-09.
>
> **Branch note (read me):** This map audits the `spike/zod-codecs` schema layer
> (`packages/core/src/pure.ts` + `src/ddl.ts`, the commit that carries `docs/PARITY.md`). The
> isolated worktree it was authored in was branched from a *divergent* older commit that lacks
> those files, so this doc may need to be moved/cherry-picked onto `spike/zod-codecs` to sit
> next to the `PARITY.md` it extends. The analysis itself is against the `spike/zod-codecs` code.
>
> **Doc-site restructure note:** SurrealDB moved its docs. The old `/docs/surrealql/**` paths
> (used by `PARITY.md`) now live under **`/docs/reference/query-language/**`**. All URLs below
> use the current structure.
>
> **Legend:** ✅ supported · ⚠️ partial/lossy · ❌ schema-layer gap · 🔮 future ORM/query-layer
> (DML / functions / operators / params / graph — out of the DDL authoring surface but a library
> concern eventually) · 🚫 out-of-scope (clients / protocol / deployment / admin).

---

## Summary — counts per status

| Status | Meaning | Count (schema-relevant features) |
|---|---|---|
| ✅ | Supported by surreal-zod today | ~70 |
| ⚠️ | Partial / lossy | 3 (`set<T>`→array, object-literal union→object, variadic tuple→array) |
| ❌ | **Schema-layer gap** (DDL the DB accepts, no `sz.*` builder) | **24** |
| 🔮 | Future ORM/query-layer (DML, ~570 functions, operators, params, graph) | ~620 (cataloged, not DDL) |
| 🚫 | Out-of-scope (clients, protocols, deployment, cloud, CLI-admin) | ~470 doc pages |

### Per-category feature counts (this crawl)

| Category | Features cataloged | Schema-relevant status spread |
|---|---|---|
| Data types | 28 types + subtypes | mostly ✅; 5 ❌ (set distinct, range, regex, sized array/set, literal-object-union) |
| `DEFINE` statements | 21 kinds | 6 ✅, 1 ⚠️, **14 ❌** |
| Table clauses | 11 | 8 ✅, **3 ❌** |
| Field clauses | 11 | 8 ✅, **3 ❌** |
| Index kinds | 9 | 3 ✅, **6 ❌** |
| Analyzer tokenizers/filters | 4 + 7 | **0 ✅** (whole `DEFINE ANALYZER` is ❌) |
| Function namespaces | 26 (~570 sigs) | 🔮 (query-layer; 5 string `is_*` baked as ASSERT) |
| Operators | ~55 | 🔮 |
| Parameters | 17 reserved | 🔮 (table/field PERMISSIONS use `$auth`/`$value` etc. inline) |
| Other statements (DML/flow/admin) | ~35 | 🔮 / 🚫 |

---

## 🆕 NEW schema-layer gaps this deep crawl found (beyond the known `PARITY.md` list)

`PARITY.md` already flagged: `set<T>`, record `REFERENCE ON DELETE`, full-text/vector indexes,
`DEFINE ANALYZER`, `CHANGEFEED`, `RELATION ENFORCED`, object-literal unions, `array<T,N>`, view
tables (`AS SELECT`), and the un-covered `DEFINE` objects (param/user/sequence/config/api/bucket/
model). **All re-confirmed live below.** The genuinely *new* gaps (ranked by schema-author value)
are:

1. **`COMPUTED` field clause** 🆕 (❌, **high value**) — a *first-class `DEFINE FIELD` clause* in
   this version, not just a query/back-reference idiom (`PARITY.md` listed `COMPUTED <~person` only
   as out-of-scope graph). The DB accepts and round-trips a computed/derived column:
   ```surql
   DEFINE FIELD full_name ON person TYPE string COMPUTED string::concat(first, " ", last);
   ```
   *Live-verified on 3.1.3* (`INFO FOR TABLE` keeps `... TYPE string COMPUTED string::uppercase('x')`).
   Suggested API: `sz.string().$computed(surql\`string::concat(first," ",last)\`)`. This mutually
   excludes `DEFAULT`/`VALUE`/`READONLY`.

2. **`DEFINE EVENT … ASYNC [RETRY n] [MAXDEPTH n]`** 🆕 (❌, medium) — async/retrying events are a
   new clause; surreal-zod's `defineEvent`/`.event()` only emit `WHEN/THEN`. Also missing:
   `COMMENT` on events. *Live-verified*: `DEFINE EVENT ev ON e ASYNC RETRY 3 MAXDEPTH 2 WHEN … THEN …`.
   ```surql
   DEFINE EVENT audit ON TABLE order ASYNC RETRY 3 MAXDEPTH 2 WHEN $event="UPDATE" THEN { … };
   ```

3. **`COUNT` index** 🆕 (❌, medium) — a materialized row-count index (`PARITY.md` listed it under
   "COUNT" but only as a one-liner; it's a distinct index kind with its own use case). *Live-verified.*
   ```surql
   DEFINE INDEX users_count ON TABLE user COUNT;
   ```

4. **`COMMENT` on index/event (and other DEFINE) objects** 🆕 (⚠️, low) — `COMMENT` exists on
   `DEFINE EVENT`, `DEFINE INDEX`, `DEFINE PARAM`, `DEFINE ANALYZER`, `DEFINE SEQUENCE`,
   `DEFINE BUCKET`, `DEFINE DATABASE`/`NAMESPACE`. surreal-zod only wires `COMMENT` on table, field,
   and function. Index/event comments are unreachable.

5. **Index `[FIELDS | COLUMNS]` + `CONCURRENTLY` + `DEFER`** 🆕 (❌, low) — `PARITY.md` mentioned
   `CONCURRENTLY` as a "modifier" but the current syntax also has the legacy `SEARCH ANALYZER …
   BM25 HIGHLIGHTS DEFER` form and a `DEFER` clause for deferred index builds. *Live-verified*
   FULLTEXT + COUNT both accept `CONCURRENTLY`.

6. **`DEFINE ACCESS RECORD … WITH JWT [ALGORITHM…|URL…] [WITH ISSUER KEY …]`** 🆕 (⚠️, medium) —
   the current RECORD access syntax nests a `WITH JWT …` block (token issuance config). surreal-zod
   models RECORD and JWT as *separate* access kinds; it cannot emit a RECORD access that also pins
   its JWT signing config. (`AUTHENTICATE` is supported; `WITH JWT`/`WITH ISSUER` are not.)

7. **`DEFINE CONFIG (API | GRAPHQL)`** 🆕 (❌, low/out-of-scope-ish) — database-level GraphQL/API
   config (`TABLES AUTO|NONE|INCLUDE`, `FUNCTIONS`, middleware). Whole-DB config, not per-table.

8. **`DEFINE MODULE @mod::@sub AS @file`** 🆕 (❌, low) — Surrealism/WASM module registration (new;
   distinct from `DEFINE MODEL` SurrealML). Out of typical schema-author scope but newly exists.

9. **`DEFINE DATABASE … STRICT`** 🆕 (❌, low) — strict mode flag on the database (rejects implicit
   schema). The CLI manages NS/DB via env, but `STRICT` is a schema-meaningful toggle.

10. **`literal` object-union is richer than "discriminated"** 🆕 (⚠️) — the DB's object-literal union
    is *not* limited to a shared discriminator key; any set of object shapes is a valid field type and
    coercion picks the matching branch. *Live-verified* `{ error: "Continue" } | { error: "Retry", id: string }`
    round-trips with full per-branch structure. surreal-zod collapses **both** `discriminatedUnion`
    **and** plain `union` of objects to bare `object`.

11. **`set<T, N>` sized set** 🆕 (❌, low) — `PARITY.md` flagged `array<T,N>`; the sized form also
    applies to sets. *Live-verified* `set<int, 5>` round-trips.

> Of these, **#1 (`COMPUTED`)** is the standout: it's a brand-new, high-value, schema-author-facing
> field clause the prior audit treated as out-of-scope query syntax.

### Biggest categories the prior audit missed

- **The entire function-library reference** (26 namespaces, ~570 signatures) — `PARITY.md` lumped
  these into one out-of-scope bullet. Cataloged in full below (relevant because `$default`/`$value`/
  `$assert` bake these into DDL, and 5 `string::is_*` validators are already baked).
- **The full operator set** (~55 operators incl. set/graph/knn/fuzzy) — one bullet before, now enumerated.
- **The reserved-parameter set** (17: `$auth`, `$value`, `$before`/`$after`, `$event`, `$input`,
  `$parent`/`$this`, `$reference` 🆕, `$request` 🆕, `$access` 🆕, `$session`, `$token`, `$action`/
  `$file`/`$target` 🆕) — used inside PERMISSIONS/ASSERT/VALUE expressions.
- **Analyzer tokenizers & filters** (blank/camel/class/punct; ascii/lowercase/uppercase/edgengram/
  mapper/ngram/snowball) — needed to author a real FULLTEXT pipeline.
- **`COMPUTED` field clause, `ASYNC` events, `STRICT` database, `WITH JWT` record access,
  `DEFINE MODULE`, `DEFINE CONFIG`** — newer DDL the old docs didn't surface.

---

## Data types — `sz.*` → SurQL `TYPE`
Docs root: https://surrealdb.com/docs/reference/query-language/language-primitives/data-types

| Type | SurQL | surreal-zod | Status | Doc |
|---|---|---|---|---|
| string | `string` | `sz.string()` | ✅ | …/data-types/strings |
| bool | `bool` | `sz.boolean()` | ✅ | …/data-types/booleans |
| int / int32 / uint32 / bigint | `int` | `sz.int()/int32()/uint32()/bigint()` | ✅ | …/data-types/numbers |
| float | `float` | `sz.float()` | ✅ | …/data-types/numbers |
| decimal | `decimal` | `sz.decimal()` | ✅ | …/data-types/numbers |
| number (generic) | `number` | `sz.number()` | ✅ | …/data-types/numbers |
| datetime | `datetime` | `sz.datetime()/sz.date()` | ✅ | …/data-types/datetimes |
| duration | `duration` | `sz.duration()` | ✅ | …/data-types/durations |
| uuid | `uuid` | `sz.uuid()` | ✅ | …/data-types/uuids |
| bytes | `bytes` | `sz.bytes()` | ✅ | …/data-types/bytes |
| file | `file` | `sz.file()` | ✅ | …/data-types/files |
| geometry (bare) | `geometry` | `sz.geometry()` | ✅ | …/data-types/geometries |
| geometry kinds (7) | `geometry<point\|line\|polygon\|multipoint\|multiline\|multipolygon\|collection>` | `sz.geometry(kind)` | ✅ | …/data-types/geometries |
| geometry `<feature>` | `geometry<feature>` (docs) | — | n/a | **docs ahead of server: 3.1.3 rejects `geometry<feature>` — parse error. Not a gap.** |
| record link | `record<t>` / `record<a\|b>` | `sz.recordId(...)` | ✅ | …/language-primitives/record-links |
| array of record | `array<record<t>>` | `sz.array(sz.recordId(t))` | ✅ | …/record-links |
| object (nested) | `object` + `f.k` subfields | `sz.object({...})` | ✅ | …/data-types/objects |
| array of object | `array<object>` + `f.*.k` | `sz.array(sz.object(...))` | ✅ | …/data-types/arrays |
| open record / map | `object` + `f.*` | `sz.record(k,v)` / `sz.map(k,v)` | ✅ | …/data-types/objects |
| literal scalar | `"admin"` / `42` | `sz.literal(v)` | ✅ | …/data-types/literals |
| enum / nativeEnum | `"a"\|"b"` / `1\|2` | `sz.enum([...])` / `sz.nativeEnum({...})` | ✅ | …/data-types/literals |
| scalar union | `string \| number` | `sz.union([...])` | ✅ | …/data-types/values |
| tuple (fixed) | `[string, number]` | `sz.tuple([...])` | ✅ | …/data-types/arrays |
| FLEXIBLE object | `object FLEXIBLE` | `.flexible()` / `.loose()` | ✅ | …/statements/define/field |
| intersection | merged `object` | `sz.intersection(a,b)` | ✅ | (DDL merge) |
| optional / nullable / nullish | `option<T>` / `T\|null` / `option<T\|null>` | `.optional()/.nullable()/.nullish()` | ✅ | …/data-types/none-and-null |
| none / null | `none` / `null` | `sz.null()` (none via optionality) | ✅ | …/data-types/none-and-null |
| **set (dedup)** | `set<T>` | `sz.set(x)` → `array<x>` | ⚠️ | **lossy.** Live: `set<string>` is DISTINCT, round-trips. …/data-types/sets |
| **sized array / set** | `array<T,N>` / `set<T,N>` | — | ❌ | **Live-verified** `array<float,3>`, `set<int,5>` round-trip. …/data-types/arrays |
| **object-literal union** | `{a:..} \| {b:..}` (any shapes) | `sz.union`/`discriminatedUnion` of objects → `object` | ⚠️ | **lossy.** Live: full per-branch structure round-trips. …/data-types/literals |
| **range** | `range` | — | ❌ | **Live-verified** bare `range` valid field type. …/data-types/ranges |
| **regex** | `regex` | — | ❌ | **Live-verified** bare `regex` valid field type. …/data-types/regex |
| string formats (bakeable) | `string ASSERT string::is_*($value)` | `sz.email()/url()/ipv4()/ipv6()/ulid()` | ✅ | (see string fns) |
| string formats (other) | `string` | `sz.jwt()/cuid()/nanoid()/base64()/…` | ✅ | (no fabricated regex) |
| futures (runtime) | `<future>{ … }` | — | 🔮 | …/data-types/futures (also valid INSIDE schema DEFAULT/VALUE) |
| closures (runtime) | `\|$x\| { … }` | — | 🔮 | …/data-types/closures |
| values / casting | `<int>x`, `<set<T>>x`, `<regex>x`, … | (codecs handle wire) | 🔮 | …/language-primitives/casting |

> **Bakeable string validators that EXIST on 3.1.3 but aren't yet baked** (potential ✅ wins for
> `sz.*` format methods): `string::is_alpha`, `is_alphanum`, `is_ascii`, `is_numeric`, `is_uuid`,
> `is_datetime`, `is_semver`, `is_hexadecimal`, `is_latitude`, `is_longitude`, `is_ip`,
> `is_domain`, `is_record`. (surreal-zod bakes only email/url/ipv4/ipv6/ulid today.)

---

## `DEFINE` statements
Docs root: https://surrealdb.com/docs/reference/query-language/statements/define/overview

| Statement | surreal-zod | Status | Notes (live-verified syntax on 3.1.3) |
|---|---|---|---|
| DEFINE TABLE | `defineTable`/`defineRelation` | ✅ | head clauses below; **`AS SELECT`/`CHANGEFEED`/`ENFORCED` ❌** |
| DEFINE FIELD | `sz.*` + `$`-clauses | ✅ | **`REFERENCE`/`COMPUTED` ❌** (below) |
| DEFINE INDEX | `.index()/.unique()/.index(name,fields,{unique})` | ✅ (plain/unique/composite) | **FULLTEXT/HNSW/DISKANN/COUNT/CONCURRENTLY/DEFER ❌** |
| DEFINE EVENT | `.event()` / `defineEvent()` | ✅ (WHEN/THEN) | **`ASYNC RETRY/MAXDEPTH` 🆕❌, `COMMENT` ❌** |
| DEFINE FUNCTION | `defineFunction()` | ✅ | args/returns/body/permissions/comment all supported |
| DEFINE ACCESS | `defineAccess()` | ✅ (RECORD/JWT/BEARER + DURATION) | **`WITH JWT`/`WITH ISSUER` on RECORD 🆕❌** |
| DEFINE ANALYZER | — | ❌ | TOKENIZERS (blank/camel/class/punct) FILTERS (ascii/lowercase/uppercase/edgengram/mapper/ngram/snowball). Live ✅ as DDL. Prereq for FULLTEXT. |
| DEFINE PARAM | — | ❌ | `DEFINE PARAM $x VALUE … [PERMISSIONS …] [COMMENT …]`. Live-verified. |
| DEFINE SEQUENCE | — | ❌ | `DEFINE SEQUENCE s [BATCH n] [START n] [TIMEOUT d]`. Live-verified; `sequence::nextval()`. |
| DEFINE USER | — | ❌ (admin) | `… ON [ROOT\|NS\|DB] [PASSWORD\|PASSHASH] [ROLES …] [DURATION FOR TOKEN/SESSION]` |
| DEFINE NAMESPACE | — | ❌ (admin) | CLI manages via env |
| DEFINE DATABASE | — | ❌ (admin) | **`STRICT` flag 🆕** |
| DEFINE CONFIG (API\|GRAPHQL) | — | ❌ 🆕 | GraphQL/API DB-level config |
| DEFINE API | — | ❌ | HTTP endpoint defs (`FOR method`, `MIDDLEWARE`, `THEN`) |
| DEFINE BUCKET | — | ❌ | object storage (`BACKEND`, `READONLY`) |
| DEFINE MODEL | — | ❌ | SurrealML model |
| DEFINE MODULE | — | ❌ 🆕 | Surrealism/WASM module (`@mod::@sub AS @file`) |
| DEFINE TOKEN *(deprecated)* | — | 🚫 | superseded by `DEFINE ACCESS … JWT` |
| DEFINE SCOPE *(deprecated)* | — | 🚫 | superseded by `DEFINE ACCESS … RECORD` |

### Table clauses — https://surrealdb.com/docs/reference/query-language/statements/define/table
Full syntax (verbatim): `DEFINE TABLE [OVERWRITE|IF NOT EXISTS] @name [DROP] [SCHEMAFULL|SCHEMALESS]
[TYPE [ANY|NORMAL|RELATION [IN|FROM]@t [OUT|TO]@t [ENFORCED]]] [AS SELECT … FROM … [WHERE …]
[GROUP [BY …|ALL]]] [CHANGEFEED @dur [INCLUDE ORIGINAL]] [PERMISSIONS …] [COMMENT @string]`

| Clause | surreal-zod | Status |
|---|---|---|
| TYPE NORMAL / ANY | default / `.typeAny()` | ✅ |
| TYPE RELATION (FROM/TO, open) | `defineRelation().from(A).to(B)` | ✅ |
| RELATION … ENFORCED | — | ❌ (live ✅ DDL) |
| SCHEMAFULL / SCHEMALESS | `.schemafull()/.schemaless()` | ✅ |
| DROP | `.drop()` | ✅ |
| COMMENT | `.comment()` | ✅ |
| PERMISSIONS (select/create/update/delete) | `.permissions()` (+ `same as`) | ✅ |
| OVERWRITE / IF NOT EXISTS | `{ exists: "overwrite"\|"ignore" }` | ✅ |
| **AS SELECT (pre-computed view)** | — | ❌ (live ✅; needs source table) |
| **CHANGEFEED @dur [INCLUDE ORIGINAL]** | — | ❌ (live ✅) |

### Field clauses — https://surrealdb.com/docs/reference/query-language/statements/define/field
Full syntax (verbatim): `DEFINE FIELD … ON [TABLE] @t [TYPE @type | object [FLEXIBLE]]
[REFERENCE [ON DELETE REJECT|CASCADE|IGNORE|UNSET| THEN @expr]] [DEFAULT [ALWAYS] @expr]
[READONLY] [VALUE @expr] [ASSERT @expr] [PERMISSIONS …] [COMMENT @string]` — and a separate
**`COMPUTED @expression`** form.

| Clause | surreal-zod | Status |
|---|---|---|
| TYPE / FLEXIBLE | inferred / `.flexible()` | ✅ |
| DEFAULT [ALWAYS] | `.$default()` / `.$defaultAlways()` | ✅ |
| VALUE | `.$value()` | ✅ |
| ASSERT | `.$assert()` + derived `$min/$max/$length/$regex/$gt/$gte/$lt/$lte` | ✅ |
| READONLY | `.$readonly()` | ✅ |
| COMMENT | `.$comment()` | ✅ |
| PERMISSIONS (select/create/update) + `$internal()` | `.$permissions()` | ✅ |
| **REFERENCE [ON DELETE REJECT\|CASCADE\|IGNORE\|UNSET\|THEN]** | — | ❌ (live ✅) |
| **COMPUTED @expr** 🆕 | — | ❌ (live ✅; derived/computed column, excludes DEFAULT/VALUE/READONLY) |

### Index kinds — https://surrealdb.com/docs/reference/query-language/statements/define/indexes
Full special-clause grammar (verbatim): `UNIQUE | COUNT | FULLTEXT ANALYZER @a [BM25 [(@k1,@b)]]
[HIGHLIGHTS] | HNSW DIMENSION @d [TYPE @t] [DIST @dist] [EFC @efc] [M @m] | DISKANN DIMENSION @d
[TYPE @t] [DIST @dist] [DEGREE @deg] [L_BUILD @lb] [ALPHA @a] [HASHED_VECTOR]]` plus `[FIELDS|COLUMNS]`,
`[COMMENT]`, `[CONCURRENTLY]`, `[DEFER]`.

| Kind | surreal-zod | Status |
|---|---|---|
| plain / UNIQUE / composite | `.index()/.unique()/.index(name,[…],{unique})` | ✅ |
| **COUNT** 🆕 | — | ❌ (live ✅: `DEFINE INDEX x ON t COUNT`) |
| **FULLTEXT ANALYZER … BM25 HIGHLIGHTS** | — | ❌ (live ✅; DB expands `BM25`→`BM25(1.2,0.75)`) |
| **SEARCH ANALYZER … BM25 HIGHLIGHTS DEFER** (legacy form) | — | ❌ |
| **HNSW DIMENSION … DIST … TYPE …** | — | ❌ (live ✅; DB fills EFC/M/M0/LM defaults) |
| **DISKANN DIMENSION … (DEGREE/L_BUILD/ALPHA/HASHED_VECTOR)** | — | ❌ (live ✅) |
| **MTREE** | — | ❌ | *(not in the current 3.1.3 index syntax box; HNSW/DISKANN/brute-force are the vector kinds. PARITY.md's MTREE entry appears stale.)* |
| **CONCURRENTLY / DEFER** | — | ❌ (live ✅) |

### Analyzer pipeline — https://surrealdb.com/docs/reference/query-language/statements/define/analyzer
`DEFINE ANALYZER @name [FUNCTION @fn] [TOKENIZERS …] [FILTERS …] [COMMENT …]`
- **Tokenizers:** `blank`, `camel`, `class`, `punct`.
- **Filters:** `ascii`, `lowercase`, `uppercase`, `edgengram(min,max)`, `mapper(path)`,
  `ngram(min,max)`, `snowball(language)`.
- Status: **❌ entirely** (prereq for FULLTEXT). Live-verified DDL accepted.

---

## Function libraries (🔮 query-layer — cataloged for completeness; the prior audit skipped these)
Docs root: https://surrealdb.com/docs/reference/query-language/functions/database-functions/overview
~570 signatures across **26 namespaces**. These are runtime/query functions, *not* DDL — but they
appear inside `DEFINE FIELD … VALUE/DEFAULT/ASSERT`, `DEFINE FUNCTION` bodies, `DEFINE EVENT … THEN`,
and PERMISSIONS, so the schema layer must accept them as opaque `surql\`…\`` (it does). **5 string
`is_*` validators are baked into ASSERT today; many more exist (see data-types note).**

| Namespace | # sigs | Examples |
|---|---|---|
| `array::` | 93 | add, append, at, clump, combine, complement, concat, difference, distinct, fill, filter, filter_index, find, find_index, first, flatten, fold, group, insert, intersect, is_empty, join, last, len, logical_and/or/xor, boolean_and/not/or/xor, map, matches, max, min, pop, prepend, push, range, reduce, remove, repeat, reverse, sequence, shuffle, slice, sort(::asc/::desc), swap, transpose, union, windows |
| `string::` | 72 | capitalize, concat, contains, ends_with, html::encode, html::sanitize, **is_alpha/alphanum/ascii/datetime/domain/email/hexadecimal/ip/ipv4/ipv6/latitude/longitude/numeric/record/semver/ulid/url/uuid**, join, len, lowercase, matches, repeat, replace, reverse, semver::*, similarity::fuzzy, slice, slug, split, starts_with, trim, uppercase, words |
| `math::` | 50 | abs, acos…, ceil, clamp, deg2rad, fixed, floor, interquartile, lerp, ln, log/10/2, max, mean, median, midhinge, min, mode, nearestrank, percentile, pow, product, rad2deg, round, sign, sin/cos/tan…, spread, sqrt, stddev, sum, top/bottom, trimean, variance |
| `time::` | 72 | ceil, day, floor, format, from::(millis/micros/nanos/secs/ulid/unix/uuid), group, hour, is_leap_year, max, micros, millis, min, minute, month, nano, now, round, second, set_*(day/hour/minute/month/nanosecond/second/year), unix, wday, week, yday, year |
| `type::` | 60 | array, bool, bytes, datetime, decimal, duration, field, fields, file, float, int, number, point, range, record, string, table, uuid, of, **is_*(array/bool/bytes/collection/datetime/decimal/duration/float/geometry/int/line/multiline/multipoint/multipolygon/none/null/number/object/point/polygon/record/string/uuid)** |
| `crypto::` | 14 | argon2::compare/generate, bcrypt::*, pbkdf2::*, scrypt::*, blake3, joaat, md5, sha1, sha256, sha512 |
| `http::` | 12 | get, head, post, put, patch, delete |
| `parse::` | 11 | email::host/user, url::domain/fragment/host/path/port/query/scheme |
| `rand::` | 27 | bool, duration, enum, float, id, int, string, time, ulid, uuid, uuid::v4 |
| `session::` | 6 | ac, db, id, ip, ns, origin |
| `meta::` | 3 | id, table, tb |
| `geo::` | 11 | area, bearing, centroid, distance, hash::decode, hash::encode, is_valid |
| `vector::` | 20 | add, angle, cross, divide, dot, magnitude, multiply, normalize, project, scale, subtract, distance::(chebyshev/euclidean/hamming/knn/manhattan/minkowski), similarity::(cosine/jaccard/pearson) |
| `search::` | 7 | analyze, highlight, linear, offsets, rrf, score |
| `count::` / `count()` | 1 | `count()` (+ COUNT index) |
| `encoding::` | 24 | base64::decode/encode, cbor::decode/encode, json::decode/encode |
| `object::` | 13 | entries, extend, from_entries, is_empty, keys, len, remove, values |
| `record::` | 4 | exists, id, is_edge, tb |
| `duration::` | 20 | days, from::(millis/days/hours/micros/millis/mins/nanos/secs/weeks), hours, micros, millis, mins, nanos, secs, weeks, years |
| `bytes::` | 3 | len |
| `set::` 🆕 | ~20 | mirror of array:: (add, all, any, at, complement, contains, difference, filter, find, first, flatten, fold, join, last, len, map, max, min, reduce, slice, union) |
| `sequence::` | 1 | nextval |
| `sleep::` / `sleep()` | 1 | `sleep(@duration)` |
| `value::` 🆕 | 3 | diff, expect, patch |
| `api::` | 28 | invoke, req::body, res::(body/header/headers/status), timeout |
| `file::` | 13 | bucket, get, key, list |
| `not()` | 1 | `not(@value)` |
| `ml::` | n/a | `ml::<model><version>(…)` (SurrealML) |

---

## Operators (🔮) — https://surrealdb.com/docs/reference/query-language/language-primitives/operators
~55 operators. Logical: `&&`/`AND`, `||`/`OR`, `!`, `!!`, `??`, `?:`. Equality/compare: `=`/`IS`,
`!=`/`IS NOT`, `==`, `?=`, `*=`, `<`, `<=`, `>`, `>=`. Fuzzy: `~`, `!~`, `?~`, `*~`. Arithmetic:
`+`, `-`, `*`/`×`, `/`/`÷`, `**`. Set/containment: `CONTAINS`/`∋`, `CONTAINSNOT`/`∌`, `CONTAINSALL`/`⊇`,
`CONTAINSANY`/`⊃`, `CONTAINSNONE`/`⊅`, `INSIDE`/`IN`/`∈`, `NOTINSIDE`/`NOT IN`/`∉`, `ALLINSIDE`/`⊆`,
`ANYINSIDE`/`⊂`, `NONEINSIDE`/`⊄`. Geo: `OUTSIDE`, `INTERSECTS`. Full-text: `@@` (matches). KNN:
`<|k|>` / `<|k,dist|>`. Range: `..` (and `id:1..10`). Graph: `->` / `<-`. Idiom: `.{}` destructuring,
`.*`, `?.` optional parts, recursive paths.

---

## Parameters (🔮) — https://surrealdb.com/docs/reference/query-language/language-primitives/parameters
17 reserved: `$access` 🆕, `$action`/`$file`/`$target` 🆕, `$auth`, `$before`, `$after`, `$event`,
`$input`, `$parent`, `$this`, `$reference` 🆕, `$request` 🆕, `$session`, `$token`, `$value`. (`$scope`
is legacy → `$access`.) These appear inside table/field PERMISSIONS, ASSERT, VALUE, DEFAULT, and
event/function bodies — surreal-zod passes them through opaquely in `surql\`…\``, which is correct.

---

## Other statements & primitives

| Area | Items | Status |
|---|---|---|
| DML | SELECT, CREATE, INSERT [RELATION/IGNORE/ON DUPLICATE KEY UPDATE], UPSERT, UPDATE, DELETE, RELATE | 🔮 |
| Mutation modes | CONTENT, MERGE, PATCH, REPLACE, SET, UNSET | 🔮 |
| Flow / control | IF…ELSE, FOR…IN, LET (`LET $x: @type = …`), RETURN, THROW, BREAK, CONTINUE, SLEEP | 🔮 |
| Transactions | BEGIN, COMMIT, CANCEL ([TRANSACTION]) | 🔮 |
| Live / change | LIVE SELECT ([VALUE]/DIFF + FETCH), KILL, SHOW CHANGES FOR TABLE … SINCE … | 🔮 |
| Admin / introspect | INFO FOR [ROOT/NS/DB/TABLE/USER/INDEX], REMOVE (all kinds), ALTER (all kinds), REBUILD INDEX [CONCURRENTLY], USE, EXPLAIN [ANALYZE] [FORMAT TEXT/JSON], ACCESS (GRANT/SHOW/REVOKE/PURGE) | 🚫 / partial (CLI uses INFO/REMOVE/overwrite internally) |
| Clauses (SELECT) | FROM, WHERE, SPLIT, GROUP [BY/ALL], ORDER, LIMIT, START, FETCH, OMIT, WITH [INDEX/NOINDEX], EXPLAIN, TIMEOUT, PARALLEL | 🔮 |
| Casting | `<int>`, `<float>`, `<decimal>`, `<bool>`, `<string>`, `<datetime>`, `<duration>`, `<uuid>`, `<regex>`, `<array>`, `<array<T>>`, `<set>`, `<set<T>>`, `<record>`, `<record<T>>` | 🔮 / (codecs) |
| Comments | `--`, `//`, `#`, `/* */` | n/a |
| Idioms | field/index access, `.*`, method chaining, graph nav, destructuring, optional parts, recursive paths | 🔮 |
| Scripting | embedded JS functions (`function(){}`), built-in fns, type conversion | 🔮 |
| Formatters | date/time/timezone strftime-style formatters for `time::format` | 🔮 |

`ALTER` 🆕 deserves a note: SurrealDB has a full `ALTER` family (access/analyzer/api/bucket/config/
database/event/field/function/indexes/namespace/param/sequence/system/table/user). surreal-zod's CLI
achieves schema evolution via diff + `OVERWRITE`/`REMOVE` rather than `ALTER`; not a gap, just an
implementation choice to note.

---

## Out-of-scope inventory (🚫 — clients / protocol / deployment / cloud)
Inventoried lightly from the sitemap (not crawled page-by-page):
- **SDKs** (`/docs/sdk/**`, `/docs/languages/**` ≈265 pages): JS, Python, Rust, Go, Java, .NET, PHP, …
- **REST/RPC** (`/docs/reference/rest-api/**`): HTTP, RPC, CBOR protocols.
- **CLI** (`/docs/reference/cli/**`): start, sql, import, export, ml, mcp, upgrade, validate, fix, isready, version, module, env vars.
- **Deployment / Cloud** (`/docs/build/deployment/**`, ≈40 pages): Docker, K8s, EKS/AKS/GKE, SurrealDB Cloud.
- **Integrations / AI** (`/docs/build/integrations/**`, `/docs/build/ai-agents/**`): LangChain, LlamaIndex, MCP, embeddings providers, n8n, Fivetran, Airbyte.
- **Embedding** (`/docs/build/embedding/**`): in-process engines per language.
- **Learn / Explore / Manage** (`/docs/learn/**` 100, `/docs/explore/**` 44, `/docs/manage/**` 27): tutorials, concepts, Surrealist, security guides.
- **SurrealML** (`/docs/surrealml`), **Surrealist** (`/docs/surrealist`).

---

## Crawl coverage (auditable)

**Enumeration:** UNION of (a) `https://surrealdb.com/docs/sitemap.xml` → **709 doc URLs**, (b)
`https://surrealdb.com/llms.txt` (section-level only), (c) BFS of in-page `/docs/` links. The
schema-critical reference (`/docs/reference/query-language/**` = **147 URLs**) was enumerated in full.

**Pages from which structured data was extracted (browser `fetch` + DOM parse):**

*Data types (24):* data-types (overview), numbers, strings, booleans, sets, arrays, literals, ranges,
regex, futures, closures, datetimes, durations, uuids, bytes, files, geometries, objects, record-ids,
none-and-null, values; record-links, record-references, casting.

*Statements / DEFINE (49):* define/{overview, table, field, indexes, event, function, analyzer, param,
user, namespace, database, access, access/record, access/jwt, access/bearer, api, bucket, config,
sequence, module, scope, token}; select, create, insert, upsert, update, delete, relate, remove,
rebuild, info, live-select, kill, show, let, return, throw, for, if-else, begin, commit, cancel, break,
continue, use, sleep, access, explain.

*Functions (26 namespaces):* array, string, math, time, type, crypto, http, parse, rand, session, meta,
geo, vector, search, count, encoding, object, record, duration, bytes, set, sequence, sleep, value, api,
file, not; + ml-functions.

*Primitives (7):* operators, parameters, idioms, formatters, comments, transactions, analyzer.

**Live-verified on SurrealDB 3.1.3** (scratch `__sz_map`, dropped): `set<string>`, `array<float,3>`,
`set<int,5>`, object-literal union, `COMPUTED`, `record<u> REFERENCE ON DELETE CASCADE`, `range`,
`regex`, `geometry<point>` (✅) / `geometry<feature>` (✗ rejected), `CHANGEFEED 3d INCLUDE ORIGINAL`,
`EVENT … ASYNC RETRY 3 MAXDEPTH 2`, `FULLTEXT ANALYZER … BM25 HIGHLIGHTS`, `COUNT` index,
`HNSW DIMENSION 4 DIST COSINE TYPE F32`, `DEFINE PARAM`, `DEFINE SEQUENCE`, `DEFINE ANALYZER`,
`RELATION FROM…TO…ENFORCED`, `AS SELECT` (syntax valid).

**Could not reach / not crawled page-by-page:** the ~470 non-schema pages (SDKs, CLI, deployment,
cloud, integrations, learn/explore/manage, REST/RPC) were inventoried from the sitemap but not opened
individually (out of scope per mission). No schema-relevant page failed to load. `geometry<feature>`
is the only doc-vs-server discrepancy found (docs ahead of 3.1.3).

---

## Net recommendation (ranked schema-layer fixes)

1. `set<T>` → emit `set<T>` not `array<T>` (one-line fix in `ddl.ts inferField` `case "set"`).
2. **`COMPUTED` field clause** 🆕 — `.$computed(surql)` (high value, brand-new clause).
3. Record `REFERENCE [ON DELETE …]` — `.reference({ onDelete })`.
4. FULLTEXT + `DEFINE ANALYZER` (search apps).
5. Vector indexes HNSW / DISKANN (AI/RAG).
6. Object-literal unions — emit `{…} | {…}` for unions/discriminatedUnions of objects.
7. `array<T,N>` / `set<T,N>` sized.
8. `CHANGEFEED`, `RELATION ENFORCED`, `COUNT` index 🆕, `DEFINE EVENT … ASYNC` 🆕.
9. `range` / `regex` bare types (`sz.range()` / `sz.regexType()`).
10. `DEFINE PARAM`, `DEFINE SEQUENCE` (reasonable near-term additions).
11. Bake the additional `string::is_*` validators that exist on 3.1.3 (alpha/alphanum/ascii/numeric/
    uuid/datetime/semver/hex/latitude/longitude/ip/domain/record).
</content>
