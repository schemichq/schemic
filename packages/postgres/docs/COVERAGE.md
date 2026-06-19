# Driver Coverage — `@schemic/postgres`

> A complete, honest map of PostgreSQL's schema/DDL surface vs what this driver supports. The driver
> now has a **pg-native `s.*` authoring surface** (built on `@schemic/core/authoring`) that lowers to
> the portable IR; `emit` turns the IR into pg DDL, `introspect` reads it back. Execution engine is
> **PGlite** (embedded), which also serves as the `shadow` capability. See `docs/AUTHORING-MAPPING.md`
> for the full vocabulary → IR mapping.

**Legend:** `[ ]` not implemented · `[~]` partial (emit-only / no introspect / known gap) · `[x]` full
round-trip (author `s.*` → lower → emit → introspect → diff = 0) · `[n/a]` no analogue

> **Verified example cookbook:** `examples/reference/*.ts` — authoring paired with its EXACT emitted
> DDL golden, asserted pure (`emit(defs) === ddl`) by `test/examples/reference.test.ts` so it can't
> drift. The drift-proof source for landing/docs snippets. See
> `packages/core/docs/EXAMPLE-COOKBOOK-CONVENTION.md`.

---

## Kind inventory (registry migration)

> Per the kind-registry contract (`packages/core/docs/kind-registry-contract.md`): core no longer
> hard-codes object kinds — each driver **registers** its kinds on a per-driver `KindRegistry` and core
> orchestrates generically. This table tracks **every** PostgreSQL object kind, its registration status,
> and round-trip coverage, so gaps stay visible. **Option-A flip DONE:** the live `postgresDriver` IS
> the registry — `{ registry, explode, introspectAll, connect/apply/close, … }`; the fixed-slot
> `lower`/`emit`/`diff`/`normalize`/`equal`/`introspect` are gone, and core runs the generic spine
> (`lowerSchema`/`buildKindDiff`/`emitKinds`) over the kinds. `explode = splitTables(pgLower(...))`,
> `introspectAll = splitTables(pgIntrospect(...))` (one read, complete: table + index + FK), so a clean
> apply round-trips to a zero diff (`test/{kinds,postgres,authoring}.test.ts`, real PGlite).
>
> `column` and the field-level clauses are **substrate** (shared `PortableField`/`PortableType`), nested
> inside the `table` kind — **not a kind**. Inline FK/UNIQUE/index are **driver-side exploded** out of
> the table by `splitTable` into their own kind objects (`deps`→table(s)) — this is what lets the
> dependency graph break mutual-FK cycles.

| kind | `createKind'd?` | emit | introspect | diff | notes |
|---|---|---|---|---|---|
| `table` | [x] | [x] | [x] | [x] | registered; columns nest as substrate; `overwrite` = clause-level column ALTER (type/null/default/comment), recreate-fallback for identity/generated/CHECK/PK; **`canonical` excludes DEFAULT/CHECK/GENERATED/COMMENT + table-CHECK from change-detection** (emit stays faithful; no phantom-diff vs introspect); **`displayItems` = per-field, grouped under the table** |
| `column`* (substrate) | [n/a] | [x] | [x] | [x] | not a kind — `PortableField`/`PortableType` nested in `table`; substrate keeps `native{params}`+`check` |
| `index` | [x] | [x] | [x] | [x] | registered; `deps`→table (no `owner`, rank-grouped); emits `CREATE [UNIQUE] INDEX`; change = drop+recreate. **Plain btree indexes — UNIQUE and NON-unique — introspect (pg_index, excl. PK / partial / expression / non-btree) → full round-trip, no phantom** (real index add/drop diffs). Partial / expression / method indexes (gin/gist/brin/hash) still not emitted or read |
| `constraint` (FK; PK/UNIQUE/CHECK/EXCLUDE TBD) | [x] | [x] | [x] | [~] | FK registered; `deps`→[table, refTable] breaks mutual-FK cycles; change = drop+recreate; FK + actions introspect (canonicalized UPPERCASE, no phantom); PK is table substrate; UNIQUE rides `index`; CHECK/EXCLUDE TBD |
| `view` | [ ] | [ ] | [ ] | [ ] | not implemented |
| `materialized_view` | [ ] | [ ] | [ ] | [ ] | not implemented |
| `sequence` (standalone) | [ ] | [ ] | [ ] | [ ] | identity-backed sequences are implicit today; standalone `CREATE SEQUENCE` not impl |
| `type`/`enum`/`domain` (`CREATE TYPE`) | [ ] | [ ] | [ ] | [ ] | `PortableDb.natives[]` slot exists; `s.enum` projects to `text` App-side today; native `CREATE TYPE` not impl |
| `extension` | [ ] | [ ] | [ ] | [ ] | needed for citext/postgis/pgvector; not impl |
| `function` | [ ] | [ ] | [ ] | [ ] | opaque kind (no `overwrite`/`deps`); trivial once structured path proven; not impl |
| `procedure` | [ ] | [ ] | [ ] | [ ] | opaque kind; not impl |
| `trigger` | [ ] | [ ] | [ ] | [ ] | own kind, `deps`→table + any function it calls; not impl |
| `schema` | [ ] | [ ] | [ ] | [ ] | hardcoded `public` today; not impl |
| `role`/`grant` | [ ] | [ ] | [ ] | [ ] | out of scope for now |
| `policy` (RLS) | [ ] | [ ] | [ ] | [ ] | own kind, `deps`→table; not impl |

\* `column` is substrate nested in `table`, listed for completeness — it is never registered as a kind.

---

### Authoring (`s.*`, pg-native)
- [x] `PgField extends SFieldBase` — Zod drop-in + `PgMeta` side-channel; full Zod wrapper/passthrough chain, type-preserving
- [x] `defineTable(name, { col: s.* })` → `PgTableDef` (an `Authored`); `.primaryKey(...)`, `.check(expr)`, `.index([...])`
- [x] `postgresDriver.lower(tables, defs)` → portable IR (replaces the old `throw`)
- [x] `s.$postgres(pgType, codec)` escape-hatch FACTORY (Zod codec App-side, stored as the given pg type)
- [x] `.$postgres(wire, codec?)` chainable escape-hatch METHOD on a field — attach a pg storage type + codec to an otherwise-unmappable App value (e.g. `s.instanceof(Money).$postgres(s.varchar(32), {encode,decode})`); mirrors surreal's `.$surreal`. Column emits as the wire type; codec maps app<->wire. (Wire-side codec types are loose today because the `s.*` leaf factories return a wide `PgField<ZodType>` — see gap below.)

### Tables & schemas
- [x] `CREATE TABLE` (in `public`); implicit `"id" text PRIMARY KEY` when no custom PK
- [x] custom / **composite** PRIMARY KEY (`PortableTable.primaryKey` → `PRIMARY KEY (a, b)`, no implicit id)
- [ ] multiple schemas / `CREATE SCHEMA` (hardcoded `public`)
- [ ] table `COMMENT`, partitioning, inheritance, `UNLOGGED`/`TEMP`
- [n/a] relation/any table kinds (Surreal-only)

### Column types — scalars (portable, round-trip)
- [x] `text` ⇄ `string`, `integer` ⇄ `int`, `double precision` ⇄ `float`, `boolean` ⇄ `bool`
- [x] `numeric` (bare) ⇄ `decimal`, `timestamptz` ⇄ `datetime`, `uuid`, `bytea` ⇄ `bytes`, `interval` ⇄ `duration`

### Column types — pg-native (round-trip via `native{params}`)
- [x] `varchar(n)` / `char(n)` (length preserved)
- [x] `numeric(p, s)` (precision/scale preserved)
- [x] `bigint`, `smallint`, `real`
- [x] `timestamp` (without tz), `date`, `time`, `timetz`
- [x] `inet`, `cidr`, `macaddr`, `money`
- [x] `jsonb` (opaque on disk, sub-structure by App-side Zod), `s.object(shape)` → `jsonb`
- [~] `json` → `native "json"` (round-trips), distinct from `jsonb`
- [~] `s.enum([...])` → `text` (App-side Zod enum; no native `ENUM`/`CHECK` yet)
- [~] `citext` (emit-only; needs the extension — gap below)
- [x] `T[]` arrays of canonical element types; [~] arrays of pg-native element types (udt-name mismatch)

### Nullability & identity
- [x] `NULL` / `NOT NULL`; `option<T>` and `T | null` both collapse to a nullable column (documented projection)
- [x] `GENERATED { ALWAYS | BY DEFAULT } AS IDENTITY` (`s.integer().$identity()`); `s.serial()`/`s.bigserial()` model as identity

### Foreign keys
- [x] single-target `s.references(table)` → `text` + `FOREIGN KEY … REFERENCES t(id)`
- [x] `ON DELETE` / `ON UPDATE` referential actions (`$references`/`s.references` opts)
- [~] multi-target record → plain `text`, no FK (polymorphic FK out of scope)
- [ ] composite / multi-column FK; FK to a non-`id` column

### Constraints, defaults, indexes
- [~] `DEFAULT <expr>` (`$default`) — **emitted faithfully** (literal or `sqlExpr(...)`), excluded from equality (Postgres rewrites it)
- [~] field `CHECK` (`$check`) and table `CHECK` (`.check`) — emitted, excluded from equality (expr rewrite)
- [~] `GENERATED ALWAYS AS (expr) STORED` (`$generated`) — emitted, excluded from equality
- [x] `UNIQUE` (`$unique` / `.index({unique})`) → `CREATE UNIQUE INDEX` — emitted AND introspected (full round-trip)
- [x] secondary `.index([...])` (non-unique) → `CREATE INDEX` — emitted AND introspected (full round-trip)
- [~] column `COMMENT` (`$comment`) — emitted (`COMMENT ON COLUMN`), not introspected back (excluded from drift, so no phantom)
- [ ] secondary index methods (gin/gist/brin/hash), partial/expression indexes
- [ ] `EXCLUDE` constraints

> The `[~]` clauses above are a deliberate, documented line: Postgres **rewrites** default/check/
> generated expressions on read (`'x'` → `'x'::text`, `a>0` → `(a > 0)`), so an exact string round-trip
> isn't reliable. They emit correctly (so generated DDL is complete) but don't participate in equality/
> diff yet. A future pass can canonicalize via the shadow engine (apply both sides, compare introspect).

### Higher-level objects
- [ ] native `ENUM` / `DOMAIN` (`CREATE TYPE`), `EXTENSION` (PostGIS/citext/pgvector) — the IR now has a
  generic `PortableDb.natives[]` slot for these; emission/introspection is a follow-up
- [ ] `VIEW` / materialized view, `FUNCTION` / `PROCEDURE`, `TRIGGER`, `SEQUENCE` (standalone), RLS policies
- [n/a] Surreal-only constructs (events, access, db functions, relations, changefeed, permissions) — dropped, no DDL

### Migration / diff
- [x] field-level `ALTER TABLE ADD/DROP COLUMN` (non-destructive), table create/drop, nullability change, reversible `down`
- [~] column **type** change (best-effort cast); whole-object `overwrite` (coarse)
- [ ] diff of the new clauses (identity/PK/default/check/FK-actions) — diff is still type/nullability-level

### Connection & engine
- [x] `postgresConnection(...)` factory (static / resolver / keyed collection); `connect` reads `config.params.url`
- [x] `Driver.query` (named `$name` + vars → positional `$1..$n` bind params); `pgSql` safe template builder
- [x] embedded PGlite (`file:<dir>` data dir or in-memory); `shadow.roundTrip` + `shadow.ephemeral`
- [~] real network Postgres (node-postgres) — `PgConn` is structural so a `pg` client fits; `connect` only builds PGlite (future)

---

### Driver semantics / known gaps (where the honesty lives)
- **option/nullable collapse** — both indistinguishable as pg columns; `normalize` folds option → nullable.
- **expression clauses don't round-trip** — default/check/generated emit but are excluded from equality (pg rewrites them); see the note above.
- **comment emits but isn't introspected back** — `[~]`; but `COMMENT` is excluded from drift detection, so it doesn't phantom-diff (plain + unique indexes now DO round-trip).
- **overriding the implicit `id`** — declare your own PK column (`id: s.uuid().$primaryKey()`, `s.serial()`, `.primaryKey("col")`) to replace the `id text` default; uuid/serial/bigint id overrides + composite/natural keys all round-trip. (A PK column literally named `id` of type `text` is treated as the implicit one — name it otherwise if you want an authored text id.)
- **objects are opaque** — nested objects collapse to a single `jsonb` column; sub-structure lives App-side (Zod), not in the IR.
- **arrays of pg-native element types** — round-trip only for canonical element types (udt-name vs type-name mismatch otherwise).
- **diff predates authoring** — the field-level diff doesn't yet handle identity/PK/clause changes; the round-trip path (emit/introspect/equal) does.
