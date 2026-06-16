# `@schemic/postgres` authoring — vocabulary → portable IR mapping (spec)

> Design spec for the pg-native `s.*` surface and `postgresDriver.lower`. Independent of core's base
> extraction (this is pure pg semantics); the `PgField`/`SFieldBase` wiring lands once core ships the
> base. Goal per Manuel: **exhaustive + pg-native lingo + best DX**. Legend mirrors COVERAGE.md:
> `[x]` round-trips (author → lower → emit → introspect → diff=0) · `[~]` partial · `[ ]` blocked on an IR/emit gap.

## Pipeline

```
pg s.*  ──lower──►  PortableDb (IR)  ──emit──►  pg DDL  ──introspect──►  IR  ──diff──►  0
(new: PgField + PgMeta)   (have, extend)         (have)           (have, extend)   (have)
```

`PgField.schema` is the portable **Zod** type (drop-in `z.*`); `PgField.native` is `PgMeta` (the pg
clause bag). `lower` reads both → `PortableField`. Side-channel metadata via WeakMap registries from
the core base — never patch Zod internals. Authoring DDL clauses already have IR slots (`PortableField`
carries `default`/`computed`/`assert`/`comment`/`readonly`/`reference.on_delete`; tables carry
`indexes`) — so most clauses need only **emit** extension, not new IR.

## Portable-vs-native decision rule

A pg type maps to a **portable** `PortableType` when it's the canonical, cross-dialect choice (so a
schema can port). pg-specific distinctions with no portable equivalent are carried as
`{ t: "native", db: "postgres", name, params? }` so they **round-trip exactly** (and can't silently
typecheck against another DB). Round-trip of a native type requires `introspect` to reproduce the same
native node (see gaps #5).

## Type vocabulary (exhaustive)

### Numeric
| `s.*` (pg lingo) | Zod schema | IR type | emit DDL | status |
|---|---|---|---|---|
| `s.smallint()` | `z.int()` | `native "smallint"` | `smallint` | [~] introspect maps `smallint`→`int` today (gap #5) |
| `s.integer()` / `s.int()` | `z.int()` | `scalar int` | `integer` | [x] |
| `s.bigint()` | `z.bigint()`/`z.int()` | `native "bigint"` | `bigint` | [~] gap #5 |
| `s.serial()` / `s.bigserial()` | `z.int()` | `native "serial"`/`"bigserial"` | `serial`/`bigserial` | [~] pg sugar: introspects as `integer` + `nextval` default (gap #3) |
| `s.numeric(p?, s?)` / `s.decimal(...)` | `z.number()` | bare→`scalar decimal`; `(p,s)`→`native "numeric" {precision,scale}` | `numeric` / `numeric(p,s)` | bare [x]; `(p,s)` [~] gap #5 |
| `s.real()` | `z.number()` | `native "real"` | `real` | [~] gap #5 (`real`→`float` today) |
| `s.doublePrecision()` / `s.float()` | `z.number()` | `scalar float` | `double precision` | [x] |
| `s.money()` | `z.string()` | `native "money"` | `money` | [~] |

### Text
| `s.*` | Zod | IR | emit | status |
|---|---|---|---|---|
| `s.text()` | `z.string()` | `scalar string` | `text` | [x] |
| `s.varchar(n?)` | `z.string().max(n)` | bare→`scalar string`; `(n)`→`native "varchar" {length}` | `text` / `varchar(n)` | bare [x]; `(n)` [~] gap #5 |
| `s.char(n?)` | `z.string()` | `native "char" {length}` | `char(n)` | [~] |
| `s.citext()` | `z.string()` | `native "citext"` | `citext` | [~] needs extension (gap #6) |

### Boolean / temporal / uuid / bytes
| `s.*` | Zod | IR | emit | status |
|---|---|---|---|---|
| `s.boolean()` / `s.bool()` | `z.boolean()` | `scalar bool` | `boolean` | [x] |
| `s.timestamptz()` | datetime codec | `scalar datetime` | `timestamptz` | [x] |
| `s.timestamp()` | datetime codec | `native "timestamp"` | `timestamp` | [~] gap #5 |
| `s.date()` | date codec | `native "date"` | `date` | [~] |
| `s.time()` / `s.timetz()` | codec | `native "time"`/`"timetz"` | `time`/`timetz` | [~] |
| `s.interval()` | duration codec | `scalar duration` | `interval` | [x] |
| `s.uuid()` | `z.uuid()` | `scalar uuid` | `uuid` | [x] |
| `s.bytea()` | `z.instanceof(Uint8Array)` | `scalar bytes` | `bytea` | [x] |

### Structured / composite
| `s.*` | Zod | IR | emit | status |
|---|---|---|---|---|
| `s.jsonb(zodShape?)` | the shape (App-land typed) | `object {fields}` (opaque on disk) | `jsonb` | [x] (sub-structure opaque, by design) |
| `s.json(zodShape?)` | shape | `native "json"` | `json` | [~] |
| `s.array(elem)` / `elem.array()` | `z.array(...)` | `array {elem}` | `<elem>[]` | [x] |
| `s.enum([...])` | `z.enum([...])` | `union` of string literals → `text` **or** `native "enum" {values}` | `text` / `CREATE TYPE … AS ENUM` | text [~]; native enum [ ] gap #6 |
| `s.inet()` / `s.cidr()` / `s.macaddr()` | `z.string()` | `native "inet"`/… | `inet`/… | [~] |
| `s.geometry(kind)` | GeoJSON codec | `geometry {kind}` | `jsonb` (or PostGIS `geometry`) | [~] no PostGIS (gap #6) |
| `s.tsvector()` | `z.string()` | `native "tsvector"` | `tsvector` | [~] |
| `s.literal(v)` | `z.literal(v)` | `literal` | base scalar | [~] |

### Links & wrappers
- `s.references(table, opts?)` / field `.references(...)` → IR `{ t: "record", tables: [table] }` + `reference.on_delete` → `text` column + FK to `table(id)`. **[x]** for `ON DELETE`; **`ON UPDATE` has no IR slot (gap #1)**.
- `.optional()` → `option<T>` (column omittable / has DEFAULT). `.nullable()` → `nullable<T>` (`NULL`). Both collapse to a nullable pg column (documented in COVERAGE.md), but kept distinct in the IR. **[x]**
- `$postgres(pgType, codec)` **escape hatch** → `native "<pgType>"`; the Zod `codec` (encode/decode) lives App/Wire-side, column stores the wire form (e.g. a domain as `text`/`jsonb`). Mirrors surreal `$surreal`. **[~]** (round-trips as the underlying native type).

## Native `$`-methods → IR clause

| `$`-method | PgMeta | IR slot | emit | status |
|---|---|---|---|---|
| `$default(value \| pgSql)` | `default` | `field.default` (verbatim pg expr) | `DEFAULT <expr>` | needs emit ext (IR slot exists) |
| `$generated(pgSql)` | `generated` | `field.computed` | `GENERATED ALWAYS AS (<expr>) STORED` | needs emit ext |
| `$check(pgSql)` | `check[]` | new `field.check?` slot (decided — gap #7) | `CHECK (<expr>)` | needs core IR + emit ext |
| `$references(t, {onDelete,onUpdate})` | `references` | `record` type + `reference.on_delete` | FK | `onUpdate` gap #1 |
| `$unique()` | `unique` | `table.indexes += {cols:[f], spec:"UNIQUE"}` | `UNIQUE` index | needs emit ext (IR slot exists) |
| `$primaryKey()` / table `$primaryKey([cols])` | `primaryKey` | — (spike forces implicit `id text` PK) | `PRIMARY KEY` | [ ] gap #2 |
| `$identity()` | `identity` | — | `GENERATED … AS IDENTITY` | [ ] gap #3 |
| `$comment(str)` | `comment` | `field.comment` | `COMMENT ON COLUMN` | needs emit ext |

Note the DX distinction: Zod `.default(x)` = App-land default (decode-time); `$default(x)` = SQL
`DEFAULT` clause. Both can coexist.

## Tables, constraints, indexes
- `defineTable(name, { col: s.* })` → `PgTableDef` (structural `Authored = {name}`); fields → `PortableField[]`.
- `.index(cols, { unique? })` → `PortableIndex` (`spec: "UNIQUE" | ""`). gin/gist/partial/expression indexes → `spec` verbatim string (extend later).
- Implicit `"id" text PRIMARY KEY` stays the convention until gap #2 (custom/composite PK) is resolved.

## IR / emit gaps to raise with core-dev (owner of the portable IR)
1. **FK `ON UPDATE`** — `reference` only has `on_delete`; add `on_update?`.
2. **Custom / composite PRIMARY KEY** — no slot; spike forces implicit `id text`. Need a table-level PK (or an index `spec:"PRIMARY KEY"`).
3. **Column identity / serial** (`GENERATED … AS IDENTITY`) — no slot; `serial` is sugar that doesn't round-trip.
4. **Table-level CHECK** — no slot for a non-field constraint.
5. **Native type round-trip** — `numeric(p,s)`, `varchar(n)`, `smallint`/`bigint`, `timestamp`, `real`: **DECIDED (A)** adopt the `native {…, params}` convention AND have pg `introspect` reproduce the same native node (today it collapses to portable scalars). Needs the `params` field sanctioned on the `native` type (already present: `{ t: "native"; …; params?: unknown }`) — confirm the shape convention.
6. **Higher-level objects** — native `ENUM`/`DOMAIN` (`CREATE TYPE`), `EXTENSION` (PostGIS/citext): emission beyond `CREATE TABLE`.
7. **Field CHECK slot** — **DECIDED (B)** add a dedicated `check?: string` (verbatim pg expr) to `PortableField`; do NOT reuse `assert` (that's surreal ASSERT semantics).

Everything marked "needs emit ext" is **mine** (extend `pgEmit` to render the IR clauses it already
ignores) — not a gap. The gaps above are core-owned IR/contract decisions.

## Decisions (locked)
- **A — adopt `native{params}`** as the round-trip carrier for widths/precision (gap #5); pg `introspect` reproduces it. Fidelity over collapse (Manuel: exhaustive > fast).
- **B — dedicated `PortableField.check?`** slot for pg `$check` (gap #7); never overload `assert`.
- **C — first slice = exhaustive** (the whole vocabulary table), building `emit` + `introspect` extensions alongside `lower`.
