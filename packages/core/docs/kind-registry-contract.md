# Kind Registry — driver contract (core-v2 hand-off)

> **Audience:** driver owners (`driver-dev-surrealdb`, `driver-dev-postgres`).
> **Status:** core slice 1 shipped on `feat/kind-registry` (commit `dbd3f7d`). The contract below is
> **live and additive** — your existing `Driver`/`PortableDb` path is untouched and still runs. Nothing
> breaks until we deliberately retire the fixed slots (last step). **No action required to keep working
> today**; this is the surface for migrating your kinds onto the registry, one at a time, green at each
> step.
>
> Design rationale: [`kind-registry.md`](./kind-registry.md). This doc is the **API + migration ask**.

## 1. The one-line idea

Core stops hard-coding object kinds (`tables`/`functions`/`accesses`/…). Each driver **registers
KINDS** on a `KindRegistry`; core orchestrates **generically** over the registry and never names a
kind. What stays in core is the **field/type vocabulary** (`s.*` Zod drop-in, `PortableType`, codecs) —
the *substrate* every kind builds on. **Fields/types are NOT a kind.**

> **Each database is its own world — kinds are NOT cross-driver compatible, and that's by design.** A
> driver's kinds, their portable forms, their DDL, and their `native` payloads are **its own**; nothing
> is meant to be shared, interchangeable, or comparable with another driver's. Don't design a kind to
> "match" another DB's, don't reach for a neutral cross-DB shape, and don't expect a schema authored for
> one driver to mean anything to another. The shared field/type substrate (above) is the **single,
> deliberate** exception — it ports across drivers because that's the whole point of the type model; the
> portable IR is "portable" so *core* can handle any kind uniformly, **not** so kinds port between DBs.
> Practical upshot: model your kinds for YOUR database's real DDL, full stop. Use `native` payloads
> freely; carry dialect clauses verbatim; never compromise fidelity for an imagined cross-DB common
> denominator.

## 2. What core now exports (`@schemic/core`)

```ts
import {
  KindRegistry,          // per-driver registry; build it once in your package
  type KindEngine,       // the behavior core needs per kind
  type Definable,        // { kind: string; name: string } — your authoring object's neutral bound
  type PortableObject,   // { kind: string; name: string } — your kind's portable form's neutral bound
  type Ref,              // { kind: string; name: string } — a dependency edge
  lowerSchema,           // (registry, defs: Definable[]) -> PortableObject[]  — author -> portable
  planKinds,             // (registry, prevP, nextP) -> { up, down }           — diff two PORTABLE sides
  buildKindDiff,         // (registry, prevP, nextP) -> Diff                    — up/down + items + full
  emitKinds,             // (registry, schemaP: PortableObject[]) -> string[]  — fresh-apply DDL
  type KindSnapshot,     // { kinds: Record<string, PortableObject[]> }        — the stored snapshot
  snapshotKinds,         // (schemaP) -> KindSnapshot  ·  snapshotObjects(snap) -> PortableObject[]
  snapshotObjects,
  introspectKinds,       // (registry, conn) -> PortableObject[] — reverse, fanned out per kind
  orderObjects,          // the dependency-graph topo-sort (exposed for testing)
} from "@schemic/core";
```

The spine works on **portable objects** (both sides already lowered) — exactly like the fixed-slot
`Driver.diff(prev, next)`. Lower the authoring side once (`lowerSchema`); the `prev` side comes from a
stored `KindSnapshot`. `buildKindDiff` returns the same `Diff` shape the CLI + migration model already
consume (`up`/`down`/`items`/`full`), so a migrated kind drops straight into the existing command paths.

### `KindEngine<A, P>` — what each kind must provide

`A` = your kind's authoring object (subtype of `Definable`). `P` = its portable object (subtype of
`PortableObject`). Both are **opaque to core** beyond the `kind`/`name` bound — core dispatches on
`kind` and nothing else.

```ts
interface KindEngine<A extends Definable, P extends PortableObject> {
  lower(authored: A): P;                          // authoring -> NORMALIZED portable (both sides converge here)
  emit(portable: P): string[];                    // CREATE DDL (fresh apply / added object's `up`)
  remove(portable: P): string[];                  // DROP DDL (removed object's `up`, added object's `down`)
  overwrite?(prev: P, next: P): string[];         // in-place CHANGE prev->next; omit => recreate (remove+emit)
  canonical?(portable: P): string;                // change-detection key; omit => emit(p).join("\n")
  displayItems?(prev: P|undefined, next: P|undefined): DiffItem[];  // per-field DISPLAY items; omit => 1 whole-object item
  deps?(portable: P): Ref[];                       // objects this must emit AFTER (cross-kind edges)
  owner?(portable: P): Ref | undefined;           // cluster next to this (readability only; never beats deps)
  introspect?(conn: unknown): Promise<P[]>;       // live conn -> all objects of THIS kind (reverse)
}
```

Semantics core relies on:

- **Change detection** defaults to `emit(prev).join("\n") === emit(next).join("\n")`. If your `emit` is
  stable for an unchanged object, core classifies add/change/remove for free. (Same idea as the
  fixed-slot engine's `before.ddl !== after.ddl`.)
- **`canonical` separates change-detection from emit** (optional). Override it when your `emit` is
  FAITHFUL but some clauses must be EXCLUDED from equality — the DB rewrites them on read (Postgres
  `'x'` -> `'x'::text`, `a>0` -> `(a>0)`) or never introspects them (a COMMENT, an index) — so a
  faithful `emit` would phantom-diff a freshly-applied schema against `introspect`. Return `emit` MINUS
  those clauses: they stay create-time faithful in `emit` but don't count as changes. `canonical(a) ===
  canonical(b)` MUST mean "no migration needed". Affects ONLY classification; the emitted DDL is
  unaffected. (Surreal doesn't need it — its `INFO STRUCTURE` forms are introspect-matchable, so emit
  IS canonical; Postgres does, for `DEFAULT`/`CHECK`/`GENERATED`/`COMMENT`/`UNIQUE`-index.)
- **`overwrite` is optional.** An opaque kind (function/access) omits it and core recreates
  (`remove(prev)` + `emit(next)`). A structured kind (table) implements it for clause-level
  `ALTER`/`OVERWRITE` that preserves data.
- **`deps` is correctness; `owner`/ordinal are presentation.** See §4.
- **`displayItems` keeps per-field diff DISPLAY** (optional). The spine's default display is ONE item
  per portable object — so a table change shows as a single `table:…` item. A structured kind overrides
  `displayItems` to decompose a change into per-SUB-OBJECT items (per-FIELD: `field:user:name`), each
  carrying its owner `table` so `schemic diff` GROUPS them hierarchically under their table — preserving
  today's per-field output. Called `(prev, next)` for a change; `(undefined, next)` lists the object's
  sub-items as adds (the `--full` projection). **DISPLAY ONLY** — never affects up/down DDL
  (`emit`/`overwrite`). Reuse the per-field diff you already compute (Surreal `diffSnapshots().items`;
  Postgres per-column from `overwrite`). Manuel's call: per-field display is the product behavior; both
  drivers implement `displayItems` at the flip so the diff UX is unchanged.

### `KindRegistry.define` — registration preserves your DX

`define` returns your **own `build` function unchanged** — full type inference + DX are yours to
design, core only registers the engine behavior. **Registration order is the kind's ordinal** (the
stable tie-break among independent objects), so register coarse-to-fine: `table` before `index`.

```ts
export const registry = new KindRegistry();

export const defineTable = registry.define({
  name: "table",
  build: <Name extends string, S extends Shape>(name: Name, shape: S) => /* your TableDef */,
  lower, emit, remove, overwrite, deps, owner, introspect,
});

export const defineFunction = registry.define({
  name: "function",
  build: (name: string) => /* your chained fn builder */,
  lower, emit, remove,            // opaque: no overwrite/deps/owner
});
```

The registry is **per-driver** (one per package), NOT a global — because `@schemic/surrealdb` and
`@schemic/postgres` are registered at once and each defines its own `"table"`/`"function"`; a shared
global map would collide.

## 3. The migration ask (start with `table`)

Migrate **kind by kind, green at each step.** We are flipping the original "function first" order:
slice 1 already proved the structured path (field-level diff + graph ordering) in core, so the
remaining risk lives in the contract's **hardest consumer — the table kind**. Validate the contract
there first, while it's still cheap to reshape (pre-launch).

**Recommended order:**

1. **`table` (+ its fields as substrate).** Fields stay **nested** inside the table's portable form
   (a table HAS fields — fields are the shared vocabulary, not a kind). The table kind owns field-level
   diff in its `overwrite`.
2. **`index` and `event` as their OWN kinds** — each with `deps`/`owner` pointing at its table (an
   index/event emits after, and clusters next to, its table). This is exactly the ordering POC's model.
3. **`access` / `function`** (opaque) — trivial once the structured path is proven.
4. Driver-specific natives (Surreal `ANALYZER`/`PARAM`/`USER`/`MODEL`; PG `EXTENSION`/`DOMAIN`/`ENUM`/
   `SEQUENCE`) become `define` calls, not new core slots.
5. Core retires the fixed `PortableDb` slots **last**.

**Parity is the bar for each step:** the kind's `planKinds` output must match the live fixed-slot
engine's `up`/`down` for representative add/change/remove cases on real DDL. Slice 1's
`packages/core/test/unit/kind-registry.test.ts` is the in-core template (a 3-kind fake driver); your
package asserts the same against your real `s.*` + emit.

### Track your kinds — a kind inventory in `docs/COVERAGE.md`

So parity stays visible rather than guessed, **each driver maintains a KIND INVENTORY** — the complete
list of object kinds its database has, with the registration status of each (registered? authoring?
emit? introspect? diff round-trips?). Add it as a section in your existing `docs/COVERAGE.md` (same
legend as the DDL-syntax map: `[ ]` not done · `[~]` partial · `[x]` full round-trip). List **every**
kind your DB supports, including ones you haven't registered yet, so the gaps are explicit. Suggested
columns: `kind name` · `createKind'd?` · `emit` · `introspect` · `diff` · notes.

Seed lists to start from (driver owner corrects/extends — these are the *expected/possible* kinds, not
a claim of completeness):

- **SurrealDB** — `table` (NORMAL/RELATION/ANY), `field`*, `index` (UNIQUE/SEARCH/MTREE/HNSW), `event`,
  `function` (`fn::`), `access` (RECORD/JWT), `param` (`DEFINE PARAM`), `analyzer`, `user`, `model`
  (`DEFINE MODEL`), `namespace`/`database` (if in scope), `config` (`DEFINE CONFIG GRAPHQL/API`),
  `api`/`bucket` (3.x, if targeted). *`field` is **substrate nested in `table`**, not its own kind.
- **PostgreSQL** — `table`, `column`*, `index`, `constraint` (PK/FK/UNIQUE/CHECK/EXCLUDE), `view`,
  `materialized_view`, `sequence`, `type`/`enum`/`domain` (`CREATE TYPE`), `function`, `procedure`,
  `trigger`, `extension`, `schema`, `role`/`grant` (if in scope), `policy` (RLS). *`column` is
  **substrate nested in `table`**.

Mark a kind `[x]` only when it **round-trips** (author → emit → introspect → diff = zero). The
inventory is what tells us — at a glance — how far each driver is through the migration.

## 4. Cross-kind dependency ordering (the load-bearing rule)

A per-kind ordinal is **not** sufficient: a table's event can call a function, so that function must
emit **before** the table — a function-before-table an ordinal gets exactly wrong. Core resolves this
with three layers (in `orderObjects`):

1. **dependency GRAPH + topological sort → correctness.** Your `deps(portable)` returns the objects
   this one must come after: a field/index → its table; an edge/relation table → its in/out tables; an
   event → its table **and any function it calls**; a search index → its analyzer.
2. **kind ORDINAL (registration order) → stable tie-break** among objects with no dependency relation.
3. **`owner` clustering → readability** (an index right after its table); never overrides `deps`.

Drops run the result in reverse (child/FK first; recreate parent-first on `down`). A genuine cycle is a
named error. Edges to objects **outside the current diff** are ignored (they already exist / aren't
changing) — so you can always return the full `deps` set.

## 5. Introspect fan-out (resolved)

The contract is **per-kind** (`KindEngine.introspect`). Introspection is usually ONE `INFO STRUCTURE` /
`pg_catalog` read that yields every kind at once — so back all of your kinds' `introspect` with a
**single memoized read** of `conn` and slice out each kind's objects. `introspectKinds` then fans out
across kinds at the cost of that one round-trip. A kind that omits `introspect` simply isn't
introspectable.

## 6. CLI integration — facade NOW, coordinated flip LAST (RESOLVED)

The registry path is **feature-complete** vs what the CLI consumes — `lowerSchema` (author → portable),
`buildKindDiff` (the full `Diff`: up/down/items/full), `emitKinds` (fresh apply), `snapshotKinds`/
`snapshotObjects`, `introspectKinds`. But the CLI today still calls the **fixed-slot** `Driver`
(`lower → PortableDb`, `emit(db)`, `diff(prev, next)`) and stores a `PortableDb` snapshot. So we
migrate in two stages:

**Stage 1 — facade (NOW, each driver, independently).** Keep your `Driver` boundary and the
`PortableDb` snapshot **unchanged** (CLI + every command stays green), and implement those methods on
top of your registry internally. The kind engines you write now are **permanent**; only a thin
`PortableDb ↔ PortableObject[]` adapter at the boundary is temporary. Most of it is free, because the
spine already returns the `Driver` shapes:

```ts
// inside your Driver:
diff(prev, next)      = buildKindDiff(this.registry, decompose(prev), decompose(next)); // Diff -> Diff
emit(db, opts)        = ... emitKinds(this.registry, decompose(db)) ...                  // string[] -> Statement[]
lower(tables, defs)   = assemble(lowerSchema(this.registry, this.explode(tables, defs))); // -> PortableDb
introspect(conn, ex)  = assemble(await introspectKinds(this.registry, conn));             // -> PortableDb
// decompose: PortableTable -> [table, ...index, ...event/constraint]   (your inline-authoring split)
// assemble:  the inverse — fold the kind objects back into PortableDb's slots for the boundary
```

Anything beyond the fixed slots (Surreal `param`/`analyzer`/`model`; PG `sequence`/`enum`/`domain`)
maps to the existing generic `natives` slot for now. The snapshot stays `PortableDb`.

**Stage 2 — the flip (LAST, ONCE, coordinated by core-dev).** After **both** drivers are
registry-internal and table-kind parity-green, core does the real Option-A flip in one coordinated
slice: the `Driver` contract gains a `registry`, the CLI routes schema ops through
`lowerSchema`/`buildKindDiff`/`emitKinds`/`introspectKinds`, the stored snapshot becomes a
`KindSnapshot`, and the fixed `PortableDb` slots retire — at which point your facade adapter is
deleted and your kind engines plug straight in, and new kinds become first-class (no longer `natives`).
This is §8's last step; it's driven by core against your **real, green** kind engines, not speculatively.

**Ping `core-dev` when your table kind is parity-green** and we line up the flip together.

## 7. Boundary decisions — RESOLVED (surrealdb review, 2026-06-16)

- **`index`/`event` as own kinds vs nested in the table — OWN KINDS.** Confirmed: matches the graph
  ordering, keeps the table kind's portable form small, and a driver that already emits separate
  `kind:index`/`kind:event` statements drops in without a reshape. `index`/`event` carry their table via
  `owner`/`deps`.
- **Substrate line — CONFIRMED.** A table's fields use `PortableField`/`PortableType` unchanged; only
  the table-level structure moves into the kind. `PortableField` already covers the full Surreal clause
  set (flexible/default(+always)/value/computed/assert/readonly/comment/reference/permissions); raise
  any field-shape your dialect needs and we keep it in the substrate.
- **`overwrite` granularity — CONFIRMED.** The spine compares whole-object `emit` strings to detect a
  change, then calls `overwrite(prev, next)` once per changed object; do clause-level sub-diffing (e.g.
  `ALTER FIELD` only the changed field) **inside** `overwrite` (slice 1's table kind shows it). A
  field add/change/remove shifts the table's `emit`, so the table flags changed and `overwrite` emits
  the field-level delta.
- **Authoring fan-out (one authored object → many kind objects) — DRIVER-SIDE EXPLODE, no contract
  hook.** A dialect that authors indexes/events/constraints **inline** on the table (Surreal; Postgres)
  expands one authored `TableDef` into `[table, ...index, ...event]` `Definable`s (each tagged with its
  `kind`) **inside its own `Driver.lower`, before calling `lowerSchema`**. `KindEngine.lower` stays a
  clean 1:1; the fan-out is dialect-specific authoring, and `lowerSchema` takes `Definable[]` so the
  driver preprocesses freely. Keep source-file linkage driver-side — exploded children inherit the
  table's file. (No `explode` hook is added to the contract; revisit only if a clean generic shape emerges.)
- **`deps` fan-out — CONFIRMED sufficient.** `deps(portable): Ref[]` returns the FULL edge set, not just
  event→function: Surreal field `VALUE`/`ASSERT`/`DEFAULT`, table/field `PERMISSIONS`, and access
  `SIGNIN`/`AUTHENTICATE` can call `fn::`; a `SEARCH` index depends on its `ANALYZER`. Return them all;
  the graph ignores edges to objects outside the current diff.

**Further questions / contract changes → DM `core-dev`** (per the repo's bridge rules). Confirmed
decisions are folded back here and into `kind-registry.md`.
