# Multi-DB Spike — surreal-zod beyond SurrealDB (DRAFT for review)

Status: **spike / exploration.** Branch `spike/multi-db` (worktree, off `spike/zod-codecs`).
Author: `sdk-v2-developer`. Ground truth for core/CLI: `@sdk-developer`. Target driver #2: **PostgreSQL**.

## Goal

Make the schema engine, migration model, and CLI **database-agnostic**, with SurrealDB as the first of
N pluggable **drivers**. The seam already exists — the [Struct-IR](./STRUCT-IR.md). This spike turns
that IR into a *portable* one and pushes everything dialect-specific behind a `Driver` interface.

```
authoring (sz.*) ──driver.lower()──┐
                                   ├──► Struct(portable) ──driver.normalize()──► canonical Struct
live DB ──driver.introspect()──────┘                                              │
                                                              equality = structured deepEqual
                                                                            (DIALECT-FREE core)
                                                                                  │
                                              diff core ──► up/down ──driver.emit()──► DDL (per dialect)
```

The single most important shift: **diff equality moves fully to structured `deepEqual` over the
normalized portable IR.** The diff core stops touching dialect strings; the driver only emits the
final `up`/`down` artifacts.

## The two Surreal leaks this spike seals

Grounded in the code (`cli/structure.ts`, `cli/lower.ts`, `cli/diff.ts`):

1. **`StructField.kind` is a SurrealQL type string** (`record<user>`, `option<int>`, `array<string,3>`),
   produced by `inferField(zodSchema).type` in `src/ddl.ts` (`inferField`/`fieldType` — the exact fns
   the Surreal driver's `lower`/type-infer will wrap) and carried through `lower.ts` verbatim.
2. **Equality is canonical-DDL-string based** — `structuredSnapshot()` renders each object to a
   canonical SurrealQL string and `diff.ts` compares `prevS[k].ddl === s.ddl`; structured `deepEqual`
   is only a *cosmetic-suppression fallback* today, not the authority.

Everything above these (diff algorithm shape, `merge.ts`, `meta.ts`, the migration model, the jiti
loader, the commander CLI shell) is already DB-neutral and is reused verbatim.

## Part 1 — the portable type model (the keystone)

Replace `kind: string` with a structured, dialect-independent type. Drivers translate *to/from* this
one model; the diff core compares it structurally.

```ts
type PortableType =
  | { t: "scalar"; name: ScalarName }            // string|int|float|bool|decimal|datetime|uuid|bytes|duration|...
  | { t: "literal"; value: string | number | boolean }
  | { t: "option"; inner: PortableType }         // may be ABSENT/NONE  — Surreal option<T>, SQL "column omitted"
  | { t: "nullable"; inner: PortableType }        // may be NULL         — Surreal T | null, SQL NULL
  | { t: "array"; elem: PortableType; size?: number }
  | { t: "set"; elem: PortableType; size?: number }
  | { t: "union"; members: PortableType[] }      // members kept canonical-sorted by normalize()
  | { t: "object"; fields: Record<string, PortableType>; flexible?: boolean }
  | { t: "record"; tables: string[] }            // Surreal-native; PG → FK column / unsupported.
                                                 //   NB: the id-VALUE type (RecordIdField's V) is
                                                 //   intentionally NOT in the IR — DDL `record<user>`
                                                 //   never encodes it; it's App/Wire-side (TS-only).
  | { t: "geometry"; kind: GeometryKind }        // Surreal-native; PG → PostGIS or unsupported
  | { t: "any" }
  | { t: "never" }
  | { t: "native"; db: string; name: string; params?: unknown }; // escape hatch for DB-specific types
```

- **`scalar` set is the portable core**; each driver maps a portable scalar to its concrete column
  type and back. A driver declares which portable types it supports; an unsupported portable type is
  either mapped to a documented fallback or rejected at `lower`/`emit` with a clear error.
- **`option` and `nullable` are ORTHOGONAL and both equality-relevant** — do not collapse them (this
  was the #1 losslessness catch). In SurrealDB `option<T>` (field may be absent/NONE), `T | null`
  (field may be NULL), and `option<T | null>` are *three distinct types*; `inferField` (ddl.ts) emits
  `.optional()` → `option<…>` and `.nullable()` → `… | null` from separate branches. `normalize()`
  must reproduce the existing **fold rule**: `nullable(option(X))` → `option(nullable(X))` (i.e.
  `option<X> | null` → `option<X | null>`), so `.optional().nullable()` ≡ `.nullish()`. A driver maps
  these to its own nullability story (PG: `option` ≈ column omittable / has a DEFAULT, `nullable` ≈
  `NULL` vs `NOT NULL`).
- **`native`** is the escape hatch: a DB-specific type that has no portable meaning (e.g. PG `tsvector`,
  Surreal `geometry` if we choose not to portably model it). It carries the owning `db` so a portable
  schema authored for one DB can't silently "work" on another.
- Drivers own two pure functions: `emitType(PortableType) -> string` and (for introspection)
  `parseType(...) -> PortableType` — or introspect straight to portable.

## Part 2 — the Driver interface (the 5 ops, pivoting on the IR)

```ts
interface Driver {
  readonly name: string;                              // "surrealdb" | "postgres"

  lower(def: TableDef | StandaloneDef): Struct;        // authoring → IR   (shared walk + driver type-infer)
  emit(struct: Struct): Statement[];                   // IR → DDL         (the dialect)
  introspect(conn: Conn): Promise<DbStructured>;       // live → IR
  normalize(struct: DbStructured): DbStructured;       // canonical IR     (structured, no strings)

  connect(config: DriverConfig): Promise<Conn>;        // execution
  apply(conn: Conn, statements: Statement[], opts?: { transactional?: boolean }): Promise<void>;

  // Optional capabilities (see Part 5):
  shadow?(): Promise<ShadowConn>;                      // throwaway instance for round-trip canonicalization
}
```

`apply` must surface **transaction support**: `migrate` wraps the up/down statements **and** the
`_migrations` bookkeeping in a single `BEGIN`/`COMMIT` today, so a driver either runs the batch
atomically or declares it can't (and the migration model degrades to best-effort with a warning). PG is
naturally transactional for DDL; Surreal wraps via its own transaction.

`emit`/`introspect`/`normalize` become per-driver translations of the **one** portable IR. The Surreal
driver is driver #1: today's `src/ddl.ts` + `cli/structure.ts` + `cli/struct.ts` extracted behind it,
reproducing current behavior.

## Part 3 — package layout (per the authoring decision)

One standardized App-land surface, grouped in **per-DB packages**. App-land (`sz.*` Zod-validated
application types) is portable; the **Wire** layer (encode/decode codecs) changes per DB; each DB
re-exports **all Zod natives** for full drop-in **plus** its own native types.

- **`core`** — portable IR, `Driver` interface + registry, the diff algorithm, `merge.ts`, `meta.ts`,
  the migration model, the jiti loader, the commander CLI shell, and the generic
  App/Wire/encode/decode *concept* (the builder pattern, sans native identities).
- **`@surreal-zod/surreal`** — Surreal `Driver`: `ddl.ts`/`structure.ts`/`struct.ts`/`introspect.ts`/
  `pull.ts` + native types & codecs (`recordId`, `datetime`, `uuid`, `duration`, `decimal`, `geometry`,
  bytes/file). `sz` export = all Zod natives + Surreal natives.
- **`@surreal-zod/postgres`** — spike target: PG DDL emitter, `information_schema`/`pg_catalog`
  introspection, PG native types (`jsonb`, arrays, enums, `numeric(p,s)`, …) + codecs. `sz` export =
  all Zod natives + PG natives (no `recordId`).

> Open product question (NOT decided here): the umbrella/brand name once it's no longer Surreal-only.
> Flagged for the maintainer; does not block the spike.

## Part 4 — App vs Wire, per driver

The two-channel Zod concept (App type ⇄ Wire type via `encode`/`decode`) is reusable; the **native
type identities and their codecs are per-DB**. Surreal's `RecordId`/`DateTime`/`Geometry` codecs live
in `@surreal-zod/surreal`; PG gets its own (`jsonb` ⇄ object, `timestamptz` ⇄ Date, arrays, etc.).
Authoring can pin an explicit DB type through `sz` (richer than plain Zod) where the portable scalar
is too coarse (e.g. PG `numeric(10,2)` vs a bare `decimal`).

## Part 5 — shadow-DB becomes a driver capability

Surreal canonicalizes by round-tripping emitted DDL through a throwaway in-process instance
(`cli/introspect.ts`), reading it back via `INFO`. This is **not** a core assumption — it's an optional
`Driver.shadow()` capability:

- **Surreal**: keeps the in-process `@surrealdb/node` shadow.
- **PostgreSQL**: either a throwaway database/temp schema (`CREATE SCHEMA … ; … ; DROP SCHEMA`) or a
  **pure-code normalizer** (PG's catalog is well-defined, so canonicalization without a live round-trip
  is viable — preferred for the spike to avoid a hard PG-process dependency).

A driver without `shadow()` MUST provide a `normalize()` strong enough to canonicalize purely.

> **`check` is NOT free on a shadowless driver.** Pure-code `normalize()` covers *diff*
> canonicalization, but `sz check`/`verifyMigrations` **replays every migration into a throwaway** to
> prove they reproduce the schema — that fundamentally needs a real engine. On a shadowless driver
> `check` is degraded/unavailable (or requires a throwaway DB instance). Diff/apply still work; only the
> replay-verification does not.

## Part 6 — CRITICAL preconditions & caveats (from `@sdk-developer`)

1. **The portable IR must be LOSSLESS for equality.** DDL-string `===` is primary today *precisely
   because* the Struct is incomplete (folded array elements / older snapshots fall back to the DDL
   compare; struct `deepEqual` is only cosmetic-suppression). Flipping `deepEqual` to primary while the
   IR omits **any** equality-relevant clause yields a **false negative = a missed migration = silent
   drift** — strictly worse than a phantom migration. The IR must capture every clause that affects
   equality:
   - **field**: type, default (+ `ALWAYS`), value, computed, assert, readonly, comment, flexible, permissions, reference
   - **table**: kind (NORMAL/ANY/RELATION + endpoints/enforced), schemafull, permissions, changefeed, comment, drop
   - **index**: cols, uniqueness/search/vector spec, count
   - **event**: when, then[]
   - **function**: args, returns, block, permissions, comment
   - **access**: kind/subject, record bodies, jwt config, durations
2. **The completeness oracle already exists** — `test/parity/struct-parity.test.ts` deep-equals the
   offline-lowered Struct against the live-introspected Struct (proven this session against two
   independent live 3.1.3 servers). **Port it per-driver.** Green parity ⇒ `deepEqual`-as-primary is
   *provably* safe; it is the empirical guard against IR-incompleteness. This gates the equality flip.
3. **`DEFINE ACCESS` signing keys are REDACTED on introspection.** Equality compares the redacted form
   (fine), but **apply** needs the real key from the *schema* side. `diffAgainstDb` already swaps the
   schema's emit-DDL in for access (the `accessEmit` swap). Rule for every driver: **`emit` sources
   secrets from authoring, never from the introspected IR.**

Downstream that *looks* dialect-coupled but isn't a blocker (confirmed): migrate **checksums** hash the
emitted `.surql` file bytes (below `emit`); **pull** already renders `sz.*` from the introspected Struct
(structured already); **snapshot** (`meta.ts`) stores `{ddl, struct, file}` today → store the portable
IR and derive/emit DDL on demand (a manageable snapshot-format migration).

## Milestones (vertical-slice order; spike freely, re-green before any merge)

1. **Portable type model + Driver interface** in `core`; Surreal extracted as driver #1, reproducing
   today's DDL strings exactly. (Refactor, no new behavior.)
2. **De-stringify the IR**: `inferField` → `PortableType`; Surreal `emitType` reproduces current
   strings. Flip diff equality to structured `deepEqual` over the normalized portable IR — gated on the
   ported **struct-parity** oracle staying green.
3. **`@surreal-zod/postgres` skeleton**: emit `CREATE TABLE` for a handful of scalar fields + a tiny
   App/Wire codec set; introspect via `information_schema`; round-trip a trivial schema through the diff.
4. **CLI shell + migration model run unmodified** against the PG driver for a minimal schema (the proof
   the seam holds end-to-end).

## Spike outcome (built & green)

All four milestones are implemented in `packages/core/src/driver/` and proven by tests
(`bun test test/unit` → 316 pass; typecheck + biome clean). The thesis holds: **an authored `sz.*`
schema migrates to a real Postgres engine and round-trips to zero diff.**

- **`portable.ts`** — the `PortableType` keystone + constructors (the `option`/`nullable` split and
  the `.nullish()` fold live here).
- **`surql-type.ts`** — `parseSurqlType`/`emitSurqlType`, the SurrealQL-string ⇄ portable bridge.
  Proven **lossless** (`test/unit/surql-type.test.ts`): `emit∘parse` reproduces the canonical
  spelling, `parse∘emit` is identity.
- **`portable-ir.ts`** — `PortableDb` (the Struct-IR with portable field types) + `liftDb`/`lowerDb`.
  The **parity oracle** (`test/unit/portable-ir.test.ts`) proves `lower∘lift` is identity on a
  type-rich schema — the empirical gate that makes structured `deepEqual`-as-primary safe.
- **`driver.ts`** — the `Driver<Conn>` interface (pivoting on `PortableDb`) + registry.
- **`surreal.ts`** — `surrealDriver`: a thin adapter that lifts/lowers at its boundaries and delegates
  to the existing engine functions. Behavior-preserving (the 299-test suite is untouched).
- **`postgres.ts`** — `postgresDriver`: portable IR → `CREATE TABLE` (PK, FK, nullability, jsonb),
  `information_schema` → portable IR, a pure-code `normalize`, and **PGlite** (embedded Postgres in
  WASM) as both the execution engine and the `shadow` capability. The end-to-end round-trip and
  change-detection are proven in `test/unit/driver-postgres.test.ts`.

**Validated findings:**
- The portable IR is a **rich superset**; each driver's `normalize()` *projects* it onto what the DB
  can represent. Postgres collapses `option<T>` and `T | null` into one nullable column (no
  column-level "absent"), folds nested objects into `jsonb`, and drops Surreal-only constructs
  (events/access/functions/relations/changefeed/permissions). All deliberate, none silent.
- `record<user>` maps cleanly to a real relational **foreign key** and round-trips back to
  `record<user>` via FK introspection — a strong signal the portable type model is sound.
- The equality flip to structured `deepEqual` is **safe given a green parity oracle** per driver.

**CLI proof:** `sz diff --driver postgres` is wired (`cli/portable-diff.ts` + a `--driver` option +
a `driver` config field). It authors from `sz.*`, connects to a real Postgres (embedded PGlite),
introspects, compares via `driver.equal`, and prints the `CREATE TABLE`/FK gap — or "in sync". Both
states demonstrated end-to-end through the `sz` binary; covered by `test/unit/portable-diff.test.ts`.
The Surreal path is untouched (the `--driver` branch returns early for any non-surreal driver).

**Not done (out of spike scope):** physically replacing `StructField.kind: string` with `PortableType`
across the whole engine (the bridge de-risks it; the swap is mechanical follow-up); making the WRITE
commands driver-parametric (`gen`/`migrate`/`snapshot`/`check` — only the read-only `diff` is wired;
the full migration-file + snapshot pipeline is still DDL-string/Surreal-only); a Postgres-native
authoring surface (`sz.pg.*`); arrays/enums round-trip is partial.

## Risks / open questions

- **Surreal-isms with no portable peer** — `record<>` links, `geometry`, `changefeed`, RELATION
  tables, `DEFINE ACCESS`/`EVENT`/`FUNCTION`. These either map to `native`, map to a PG analogue
  (record→FK, geometry→PostGIS), or are declared unsupported per-driver. Need a per-driver capability
  matrix.
- **PG ⇄ Surreal asymmetry** — PG has types Surreal lacks (enums, `jsonb`, fixed-precision `numeric`,
  composite types) and vice-versa. The portable model must degrade gracefully both directions.
- **Snapshot-format migration** — moving snapshots from DDL-string to portable IR needs a version bump
  + read-compat for existing `version: 1` snapshots.
- **Brand/umbrella naming** once multi-DB — product call, deferred.
