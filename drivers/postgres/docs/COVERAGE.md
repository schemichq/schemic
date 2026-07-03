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
| `index` | [x] | [x] | [x] | [x] | registered; `deps`→table (no `owner`, rank-grouped); change = drop+recreate. **UNIQUE/non-unique, any access METHOD (`btree` default / `gin` / `gist` / `brin` / `hash`, `.index(cols,{method})`), and PARTIAL (`.index(cols,{where})`) all introspect (pg_index + pg_am + pg_get_expr(indpred)) → full round-trip, no phantom.** `canonical` excludes the partial predicate (pg rewrites it) so a predicate-only edit isn't auto-diffed. EXPRESSION indexes (on `lower(x)` etc.) still excluded (indexprs) — can't author them yet, so reading them back would phantom-remove |
| `constraint` (FK; PK/UNIQUE/CHECK/EXCLUDE TBD) | [x] | [x] | [x] | [~] | FK registered with ordered `columns`/`refColumns` — **single-column, composite (multi-column), and non-`id`-target** all round-trip (introspect via pg_constraint conkey/confkey); `deps`→[table, refTable] breaks mutual-FK cycles; change = drop+recreate; actions canonicalized UPPERCASE, no phantom; PK is table substrate; UNIQUE rides `index`; CHECK/EXCLUDE TBD |
| `view` | [x] | [x] | [~] | [~] | `defineView(name, sql)` standalone def; registered LAST (emits after the tables it reads); emit `CREATE VIEW … AS <sql>`, introspect pg_views, drop. PRESENCE round-trips (add/drop diff); the BODY is excluded from change-detection (`canonical` = name-only) because pg rewrites view definitions (expands `SELECT *`, strips qualifiers, reformats) — so a body EDIT isn't auto-diffed yet (drop+recreate / re-gen; future: shadow-normalize) |
| `matview` (materialized view) | [x] | [x] | [~] | [~] | `defineMaterializedView(name, sql)` standalone def; registered LAST (after `view`); emit `CREATE MATERIALIZED VIEW … AS <sql>`, introspect pg_matviews, drop. PRESENCE round-trips; BODY excluded from change-detection (`canonical` = name-only, same as `view` — pg rewrites the stored definition); a body edit isn't auto-diffed (drop+recreate / re-gen) |
| `sequence` (standalone) | [x] | [x] | [x] | [x] | `defineSequence(name, opts?)` standalone def (start/increment/min/max/cache/cycle); emit only the SET attributes, `canonical` fills pg defaults so authoring-without-opts matches introspect; introspect pg_sequences EXCLUDING identity/serial-OWNED sequences (pg_depend) so auto-increment columns don't phantom-add; values read as text (bigint-safe); a real attribute change drop+recreates |
| `enum` (`CREATE TYPE … AS ENUM`) | [x] | [x] | [x] | [x] | registered before tables; `defineEnum(name, values)` standalone def, `.column()` references it; emit `CREATE TYPE`, introspect pg_type/pg_enum, full round-trip; `overwrite` = `ALTER TYPE ADD VALUE` for appended labels, drop+recreate (coarse) otherwise |
| `domain` (`CREATE DOMAIN`) | [x] | [x] | [x] | [~] | `defineDomain(name, base, opts?)` standalone def (NOT NULL / DEFAULT / CHECK), `.column()` types a column as it; emit `CREATE DOMAIN … AS <base> …`, introspect information_schema.domains + pg_type.typnotnull; a domain-typed column round-trips (introspect surfaces `domain_name`). `canonical` = name + normalized base type + NOT NULL; DEFAULT/CHECK emit-faithful but excluded (pg rewrites the expr) — a default/check edit isn't auto-diffed |
| `extension` | [x] | [x] | [~] | [x] | `defineExtension(name, opts?)` standalone def (SCHEMA/VERSION); registered FIRST; emit `CREATE EXTENSION IF NOT EXISTS`, introspect pg_extension EXCLUDING the `plpgsql` system default, drop; `canonical` = name-only. NOTE: the embedded PGlite engine bundles only a small set of extensions (citext/postgis/pgvector aren't available), so a CREATE can't be APPLIED locally — emit + introspect are supported but a live round-trip is limited to PGlite's available extensions |
| `function` | [x] | [x] | [x] | [~] | `defineFunction(name, {args, returns, language, body, …})` standalone def; registered after tables (a sql body may read them); emit `CREATE [OR REPLACE] FUNCTION … AS $$body$$`, introspect pg_proc (sql/plpgsql, excl. extension-owned), drop with signature. `canonical` = name-only — overloads NOT distinguished (use distinct names); a body/signature edit isn't auto-diffed (re-gen / `replace: true`) |
| `procedure` | [ ] | [ ] | [ ] | [ ] | not impl (same path as `function`; `CALL`-only, no RETURNS) |
| `trigger` | [x] | [x] | [x] | [~] | `defineTrigger(name, {table, timing, events, function, …})` standalone def; `deps`→[table, function]; emit `CREATE TRIGGER …`, introspect pg_trigger via pg_get_triggerdef, drop. `canonical` = name+table (pg normalizes the stored def); a definition edit isn't auto-diffed (re-gen) |
| `schema` | [ ] | [ ] | [ ] | [ ] | hardcoded `public` today; not impl |
| `role`/`grant` | [ ] | [ ] | [ ] | [ ] | out of scope for now |
| `policy` (RLS) | [x] | [x] | [x] | [~] | `definePolicy(name, {table, command, roles, using, withCheck, permissive})` standalone def; `deps`→table; emit `ALTER TABLE … ENABLE ROW LEVEL SECURITY` (idempotent) + `CREATE POLICY …`, introspect pg_policies, drop. `canonical` = name+table; USING / WITH CHECK exprs are rewritten by pg so excluded — an expr edit isn't auto-diffed (drop+recreate / re-gen) |

\* `column` is substrate nested in `table`, listed for completeness — it is never registered as a kind.

---

### Authoring (`s.*`, pg-native)
- [x] `PgField extends SFieldBase` — Zod drop-in + `PgMeta` side-channel; full Zod wrapper/passthrough chain, type-preserving
- [x] Zod CHAIN methods — string formats (`.email/.url/.uuid/.emoji/.nanoid/.cuid/.cuid2/.ulid/.guid/.xid/.ksuid/.base64/.base64url/.e164/.jwt`), string length/pattern/transform (`.min/.max/.length/.regex/.startsWith/.endsWith/.includes/.nonempty/.trim/.toLowerCase/.toUpperCase/.lowercase/.uppercase/.normalize`), number bounds (`.gt/.gte/.lt/.lte/.positive/.negative/.nonnegative/.nonpositive/.multipleOf`) — forwarded to the inner Zod schema, **App-side only (no DDL — the column type is unchanged)**; for a DB-side constraint use `.$check`. A method that doesn't apply to the base type throws (like Zod)
- [x] `defineTable(name, { col: s.* })` → `PgTableDef` (an `Authored`); `.primaryKey(...)`, `.check(expr)`, `.index([...])`
- [x] **table composition** (ratified cross-driver surface): `defineTable(name, obj)` also accepts an `s.object()` (uses its `.fields` — the native PgFields with column metadata, NOT the jsonb collapse); `PgTableDef.extend(record | s.object())` composes more columns in (typed, cast-free — the base-column mixin primitive). `s.object().fields` is the public native field map (inverse of `.shape`), retained through `.extend/.pick/.omit/…`
- [x] **derived input schemas** `PgTableDef.create` / `.update` (Standard-Schema-composable z.objects, `.or/.extend/.partial/.refine`). Precise TYPES via the `Flags` channel: `$default`/`$identity` brand `"create"` (optional on create), `$identity`/`$generated`/`$primaryKey` brand `"readonly"` (excluded from update), `$generated` brands `"generated"` (excluded from create). `.create` drops generated + makes default/identity/`id` optional; `.update` drops `id`/readonly + partials the rest. App types `CreateInput<T>`/`UpdateInput<T>`. (Mirrors surreal's `CreateShape<S>`; the `string extends FlagsOf` guard keeps shape-agnostic `PgTableDef` refs intact.)
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
- [x] `bigint` (App value is a **`bigint`** — never a `number`, so values past 2^53 don't silently lose precision), `smallint`, `real`. NOTE: PGlite returns a `bigint` (int8) column as a JS `number` when the value fits in 2^53 and a JS `bigint` only when larger, so every bigint-backed field (`bigint`/`bigserial`/`int64`/`uint32`) decodes through a number|bigint-tolerant codec that coerces to `bigint` (a `numeric` column always comes back as a string)
- [x] Zod width-numerics: `s.int32()` → `integer`, `s.int64()` → `bigint` (App `bigint`), `s.uint32()` → `bigint` (App `number`; unsigned 32 exceeds signed int4), `s.uint64()` → `numeric` (App `bigint`; unsigned 64 exceeds signed int8), `s.float32()` → `real`, `s.float64()` → `double precision`. `s.ipv4()/ipv6()/cidrv4()/cidrv6()` → `text` format validators (distinct from native `s.inet()/cidr()`)
- [x] `timestamp` (without tz), `date`, `time`, `timetz`
- [x] `inet`, `cidr`, `macaddr`, `money`
- [x] `jsonb` (opaque on disk, sub-structure by App-side Zod), `s.object(shape)` → `jsonb`; `s.object()` returns a **`PgObjectField`** carrying the Zod object-COMPOSITION methods `.extend/.merge/.pick/.omit/.partial/.required/.catchall` (+ inherited `.loose/.strict/.flexible`) + a `.shape` getter — all keep precise App types and stay one `jsonb` column. The methods live on the object subclass (not base `PgField`), so base-field ↔ `AnyField` assignability is untouched
- [~] `json` → `native "json"` (round-trips), distinct from `jsonb`
- [x] string FORMAT factories `s.email()/url()/emoji()/nanoid()/cuid()/cuid2()/ulid()/guid()/xid()/ksuid()/base64()/base64url()/e164()/jwt()` plus the long-tail `s.uuidv4()/uuidv6()/uuidv7()/httpUrl()/hostname()/hex()/mac()/hash(alg)` → a `text` column with the Zod format validator App-side (validation is client-side; the column is plain `text`). `s.uuid()` stays the native `uuid` type; `s.inet()/cidr()/macaddr()` the native network types. Nested `s.iso.{date,time,datetime,duration}` are ISO-string validators on `text` (distinct from the native temporal types `s.date()/timestamptz()/interval()`).
- [x] `s.stringbool()` → `text` column, App value `boolean` (Zod's string⇄bool codec). `s.codec(wire, app, {decode, encode})` → a low-level `z.codec` drop-in; the column type is INFERRED from the raw-Zod **wire** schema (string→text, int→integer, number→double precision, bigint→bigint, boolean→boolean, date→timestamptz, structural→jsonb). Complements `.$postgres`/`s.$postgres` (which name the pg type explicitly). `s.strictObject`/`s.looseObject` → `s.object` with the unknown-key mode preset (composable `PgObjectField`)
- [~] `s.enum([...])` → `text` (App-side Zod enum, validated client-side only — a quick inline projection). Returns a **`PgEnumField`** carrying `.exclude([...])`/`.extract([...])` to derive a narrower enum (App type narrows precisely; column stays `text`). Methods on the subclass (like `PgObjectField`), so base `PgField`/`AnyField` are untouched
- [x] `defineEnum(name, values)` → a NATIVE pg enum (`CREATE TYPE … AS ENUM`); `mood.column()` types a column as it (App = the literal union). Full round-trip; the standalone, reusable, introspected alternative to the `s.enum` text projection
- [~] `citext` (emit-only; needs the extension — gap below)
- [x] `T[]` arrays of canonical element types; [~] arrays of pg-native element types (udt-name mismatch)
- [x] composite jsonb factories — `s.record(key, value)` / `s.tuple([...])` / `s.union([...])` / `s.discriminatedUnion(disc, [...])` / `s.intersection(a, b)` / `s.lazy(() => ...)` / `s.xor([...])` (exclusive union) / `s.partialRecord(k,v)` / `s.looseRecord(k,v)` → a single `jsonb` column, App value = the composite, validated App-side (mirrors surreal's set). `map`/`set` skipped (need a Map/Set↔jsonb codec); `nativeEnum` covered by `s.enum`/`defineEnum`
- [x] schema-derivation factories — `s.stringFormat(name, fn)` / `s.templateLiteral([...])` → `text`; `s.keyof(objField | z.object)` → `text` (enum of keys); `s.preprocess(fn, inner)` → App-side wrapper that inherits the inner field's column type. (Skipped: `z.mime`/`z.slugify`/`z.property` are `$ZodCheck`es used via `.check()`, not factories; `z.function`/`z.promise`/`z.symbol` have no column meaning.)

### Nullability & identity
- [x] `NULL` / `NOT NULL`; `option<T>` and `T | null` both collapse to a nullable column (documented projection)
- [x] `GENERATED { ALWAYS | BY DEFAULT } AS IDENTITY` (`s.integer().$identity()`); `s.serial()`/`s.bigserial()` model as identity

### Foreign keys
- [x] single-target `s.references(table)` → `text` + `FOREIGN KEY … REFERENCES t(id)` (inline, rides the column)
- [x] `ON DELETE` / `ON UPDATE` referential actions (`$references`/`s.references` opts; table-level `.foreignKey` opts)
- [x] **composite / multi-column FK** — `defineTable(...).foreignKey({ columns, refTable, refColumns })`; ordered columns, full round-trip (introspect via pg_constraint conkey/confkey arrays)
- [x] **FK to a non-`id` column** — `.foreignKey({ columns: [c], refTable, refColumns: [other] })` (refColumns defaults to `["id"]`)
- [~] multi-target record → plain `text`, no FK (polymorphic FK out of scope)

### Constraints, defaults, indexes
- [~] `DEFAULT <expr>` (`$default`) — **emitted faithfully** (literal or `sqlExpr(...)`), excluded from equality (Postgres rewrites it)
- [~] field `CHECK` (`$check`) and table `CHECK` (`.check`) — emitted, excluded from equality (expr rewrite)
- [~] `GENERATED ALWAYS AS (expr) STORED` (`$generated`) — emitted, excluded from equality
- [x] `UNIQUE` (`$unique` / `.index({unique})`) → `CREATE UNIQUE INDEX` — emitted AND introspected (full round-trip)
- [x] secondary `.index([...])` (non-unique) → `CREATE INDEX` — emitted AND introspected (full round-trip)
- [x] index **access methods** — `.index(cols, { method: "gin" | "gist" | "brin" | "hash" })` → `USING <method>` (btree default, omitted); full round-trip
- [x] **partial** indexes — `.index(cols, { where: "<predicate>" })` → `… WHERE <predicate>`; round-trips (predicate excluded from drift like a CHECK — pg rewrites it)
- [~] column `COMMENT` (`$comment`) — emitted (`COMMENT ON COLUMN`), not introspected back (excluded from drift, so no phantom)
- [ ] **expression** indexes (`CREATE INDEX … ((lower(x)))`) — not authorable yet; excluded from introspection so they don't phantom-remove
- [ ] `EXCLUDE` constraints

> The `[~]` clauses above are a deliberate, documented line: Postgres **rewrites** default/check/
> generated expressions on read (`'x'` → `'x'::text`, `a>0` → `(a > 0)`), so an exact string round-trip
> isn't reliable. They emit correctly (so generated DDL is complete) but don't participate in equality/
> diff yet. A future pass can canonicalize via the shadow engine (apply both sides, compare introspect).

### Higher-level objects
- [x] native `ENUM` (`defineEnum`), `DOMAIN` (`defineDomain`), `EXTENSION` (`defineExtension`) — standalone
  defs through the driver's `explode`/`introspectAll`; see the kind table above for round-trip status
- [x] `VIEW` (`defineView`), materialized view (`defineMaterializedView`), standalone `SEQUENCE` (`defineSequence`)
- [x] `FUNCTION` (`defineFunction`), `TRIGGER` (`defineTrigger`), RLS `POLICY` (`definePolicy`) — see the kind table for round-trip status
- [ ] `PROCEDURE`, `SCHEMA` (multi), `ROLE`/`GRANT` — next via the same standalone-def path
- [n/a] Surreal-only constructs (events, access, db functions, relations, changefeed, permissions) — dropped, no DDL

### Migration / diff
- [x] field-level `ALTER TABLE ADD/DROP COLUMN` (non-destructive), table create/drop, nullability change, reversible `down`
- [~] column **type** change (best-effort cast); whole-object `overwrite` (coarse)
- [ ] diff of the new clauses (identity/PK/default/check/FK-actions) — diff is still type/nullability-level

### Query (read) builder — `@schemic/postgres/query`
> Opt-in, tree-shakeable subpath (`import { select } from "@schemic/postgres/query"`); a schema-only
> project never pulls it. Driver-OWNED operators + SQL lowering, composing the dialect-neutral machinery
> from `@schemic/core/query` (`FieldRefBase`/`Project`/`decodeProjection`) so result inference is
> cross-driver. Decodes through `PgTableDef.object` — the same row codec a full-row read uses.
- [x] `select(table)` → typed single-table `SELECT`; bare result is `App<TD>[]` (decoded)
- [x] `.where(r => …)` with `eq/neq/lt/lte/gt/gte` + `and(...)`/`or(...)`, lowered to positional `$1..$n` binds
- [x] `.orderBy(r => col, "asc"|"desc")`, `.limit(n)`
- [x] `.return(r => ({ alias: r.col, … }))` flat projection — re-types the result via core's `Project<P>`
- [x] decode-by-default (full-row via `PgTableDef.object`, projection via core's `decodeProjection`); `.raw()` opts out
- [x] `.toSQL()` renders `{ sql, params }` without executing; `.run(conn)` executes + decodes. A query may be BOUND to a connection (`select(t, conn)` or the ORM client's `db.select(t)`) — then it's **thenable** (`await` runs it) and `.run()` takes no arg; chaining preserves the binding; standalone `select(t).run(db)` still works
- [x] `PgTableDef.object` (a `z.ZodObject` over the columns) + `.decode(row)` / `.safeDecode(row)` — the row codec the builder reuses (mirrors `@schemic/surrealdb`'s `TableDef.object`/`decode`)
- [~] **implicit `id` is not queryable** — a table's implicit `id text PRIMARY KEY` is added at emit time, not a field, so it's absent from `object`/`App`/the row refs. Declare an explicit `id` column (`id: s.uuid()`, `s.text().$primaryKey()`, …) to filter/return it. (Phase-0 line; aligns with the "name your PK" guidance below.)
- [n/a] joins / CTEs / sub-selects / aggregates / writes — later phases (Phase-0 is single-table SELECT)

### ORM client — `@schemic/postgres/client` (P1: reads)
> Opt-in subpath. A disposable handle that BINDS a connection and exposes the query surface PRE-BOUND, so
> `db.select(t)` runs against the client's connection with no `.run(externalDb)` threading. Extends core's
> `OrmClientBase`; composes `./query` (the bindable/thenable builder) + `./driver`'s `connect`. Same shape
> as `@schemic/surrealdb/client` (ratified cross-driver).
- [x] `connect(name?)` MANAGED — resolves the connection from `schemic.config.ts` via core's `resolveConnection` → `postgresDriver.connect` → owned client (async)
- [x] `connect(conn)` BYO — wraps a connection you own (sync); `close()` is a **NO-OP** (never close a user's connection)
- [x] `db.select(table)` → the pre-bound, awaitable builder (`await db.select(u).where(...).return(...)`)
- [x] `db.query(sql, params?)` — RAW SQL escape hatch (thenable; raw wire rows by default). `.as(table)` decodes each row through the table's row codec; `.as(schema)` through any Standard-Schema (`User.object.pick(...)`, a `z.*`, …). Replaces reaching into `db.conn`
- [x] typed `config.connect(name)` — `postgresConnection(...)` embeds a lazy `client` opener + optional `args` Standard-Schema, typed as `ConnectionEntry<PgClient, ArgsOut>`, so `defineConfig(...).connect(name)` autocompletes names + infers the `PgClient` per entry
- [x] `AsyncDisposable` — `await using db = await connect()` closes a managed client at block exit; `[Symbol.asyncDispose] === close`
- [x] dispose rule enforced at construction (private ctor; `managed`/`byo` statics): MANAGED close closes, BYO close is a no-op
- [n/a] writes (`create/update/delete` split builder) + `db.call` + a scoped `db.session()` — P2 / later

> `$postgres` codec params are now precisely typed (`encode(app)`, `decode(wire)`), since the `s.*` leaf
> factories return a precise `PgField<S>` (the `mk<S>` generic) rather than a wide `PgField<ZodType>` —
> so the earlier "wire-side codec types are loose" gap is closed.

### CLI commands (`sc <kind> <verb>` — `Driver.commands`)
Driver-contributed commands; core discovers + dispatches them (parses argv into `ParsedCommandArgs`,
opens the connection, hands `run` a `CommandContext`). pg owns the dialect SQL in `./commands.ts`.
- [x] `sc matview refresh <name> [--concurrently]` — `REFRESH MATERIALIZED VIEW [CONCURRENTLY]`
- [x] `sc sequence set <name> <value> [--is-called true|false] [--dry-run]` — `setval(...)`; `sc sequence current <name>` — `last_value`
- [x] `sc enum add <type> <value> [--before|--after <label>] [--dry-run]` — `ALTER TYPE … ADD VALUE` (string literal, not a bound param)
- [x] `sc table count <name> [--where <expr>]`; `sc table find <name> <col=value> [--limit N]` (value bound as a param — pg infers its type); `sc table vacuum <name> [--full] [--analyze]`
- [x] `sc index reindex <name>` — `REINDEX INDEX`
- mutating commands honor `--dry-run` (print the SQL, don't run); identifiers quoted via `identifier()`, user `--where` spliced raw (CLI author trusted)

### Connection & engine
- [x] `postgresConnection(...)` factory (static / resolver / keyed collection); `connect` reads `config.params.url`
- [x] `Driver.query` (named `$name` + vars → positional `$1..$n` bind params); `pgSql` safe template builder
- [x] embedded PGlite — **`file:<dir>` persists; "" / omitted is in-memory** (a bare path without the `file:` prefix is in-memory); `shadow.roundTrip` + `shadow.ephemeral`
- [~] real network Postgres (node-postgres) — `PgConn` is structural so a `pg` client fits; `connect` only builds PGlite (future). A `postgres://` (any non-`file:` URL-scheme) url now **fails loud** — `connect` throws rather than silently running an in-memory throwaway (was a silent-data-loss footgun)

---

### Driver semantics / known gaps (where the honesty lives)
- **option/nullable collapse** — both indistinguishable as pg columns; `normalize` folds option → nullable.
- **expression clauses don't round-trip** — default/check/generated emit but are excluded from equality (pg rewrites them); see the note above.
- **comment emits but isn't introspected back** — `[~]`; but `COMMENT` is excluded from drift detection, so it doesn't phantom-diff (plain + unique indexes now DO round-trip).
- **overriding the implicit `id`** — declare your own PK column (`id: s.uuid().$primaryKey()`, `s.serial()`, `.primaryKey("col")`) to replace the `id text` default; uuid/serial/bigint id overrides + composite/natural keys all round-trip. (A PK column literally named `id` of type `text` is treated as the implicit one — name it otherwise if you want an authored text id.)
- **objects are opaque** — nested objects collapse to a single `jsonb` column; sub-structure lives App-side (Zod), not in the IR.
- **arrays of pg-native element types** — round-trip only for canonical element types (udt-name vs type-name mismatch otherwise).
- **diff predates authoring** — the field-level diff doesn't yet handle identity/PK/clause changes; the round-trip path (emit/introspect/equal) does.
