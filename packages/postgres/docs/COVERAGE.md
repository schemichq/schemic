# Driver Coverage — `@schemic/postgres`

> A complete, honest map of PostgreSQL's schema/DDL surface vs what this driver supports. The driver
> now has a **pg-native `s.*` authoring surface** (built on `@schemic/core/authoring`) that lowers to
> the portable IR; `emit` turns the IR into pg DDL, `introspect` reads it back. Execution engine is
> **PGlite** (embedded), which also serves as the `shadow` capability. See `docs/AUTHORING-MAPPING.md`
> for the full vocabulary → IR mapping.

**Legend:** `[ ]` not implemented · `[~]` partial (emit-only / no introspect / known gap) · `[x]` full
round-trip (author `s.*` → lower → emit → introspect → diff = 0) · `[n/a]` no analogue

---

### Authoring (`s.*`, pg-native)
- [x] `PgField extends SFieldBase` — Zod drop-in + `PgMeta` side-channel; full Zod wrapper/passthrough chain, type-preserving
- [x] `defineTable(name, { col: s.* })` → `PgTableDef` (an `Authored`); `.primaryKey(...)`, `.check(expr)`, `.index([...])`
- [x] `postgresDriver.lower(tables, defs)` → portable IR (replaces the old `throw`)
- [x] `s.$postgres(pgType, codec)` escape hatch (Zod codec App-side, stored as the given pg type)

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
- [~] `UNIQUE` (`$unique` / `.index({unique})`) → `CREATE UNIQUE INDEX` — emitted, not introspected back yet
- [~] column `COMMENT` (`$comment`) — emitted (`COMMENT ON COLUMN`), not introspected back yet
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
- **unique index + comment emit but aren't introspected back yet** — so they're `[~]`, not `[x]`.
- **objects are opaque** — nested objects collapse to a single `jsonb` column; sub-structure lives App-side (Zod), not in the IR.
- **arrays of pg-native element types** — round-trip only for canonical element types (udt-name vs type-name mismatch otherwise).
- **diff predates authoring** — the field-level diff doesn't yet handle identity/PK/clause changes; the round-trip path (emit/introspect/equal) does.
