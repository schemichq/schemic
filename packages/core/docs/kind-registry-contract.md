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

## 2. What core now exports (`@schemic/core`)

```ts
import {
  KindRegistry,          // per-driver registry; build it once in your package
  type KindEngine,       // the behavior core needs per kind
  type Definable,        // { kind: string; name: string } — your authoring object's neutral bound
  type PortableObject,   // { kind: string; name: string } — your kind's portable form's neutral bound
  type Ref,              // { kind: string; name: string } — a dependency edge
  planKinds,             // (registry, prev, next) -> { up, down } — the generic diff/plan spine
  emitKinds,             // (registry, defs) -> string[]   — fresh-apply DDL
  introspectKinds,       // (registry, conn) -> PortableObject[] — reverse, fanned out per kind
  orderObjects,          // the dependency-graph topo-sort (exposed for testing)
} from "@schemic/core";
```

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
  deps?(portable: P): Ref[];                       // objects this must emit AFTER (cross-kind edges)
  owner?(portable: P): Ref | undefined;           // cluster next to this (readability only; never beats deps)
  introspect?(conn: unknown): Promise<P[]>;       // live conn -> all objects of THIS kind (reverse)
}
```

Semantics core relies on:

- **Change detection** is `emit(prev).join("\n") === emit(next).join("\n")`. If your `emit` is stable
  for an unchanged object, core classifies add/change/remove for free. (Same idea as the fixed-slot
  engine's `before.ddl !== after.ddl`.)
- **`overwrite` is optional.** An opaque kind (function/access) omits it and core recreates
  (`remove(prev)` + `emit(next)`). A structured kind (table) implements it for clause-level
  `ALTER`/`OVERWRITE` that preserves data.
- **`deps` is correctness; `owner`/ordinal are presentation.** See §4.

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

## 6. Coexistence during migration

`planKinds` only plans definables whose `kind` is **registered on the registry** — anything else it
skips. So while some kinds are on the registry and others on the fixed `PortableDb` slots, run both
engines and concatenate, ordering the registry side with the graph. (Core will provide the bridge in
the slice that needs it; flagging it here so the interim state is expected, not surprising.)

## 7. Open boundary decisions — confirm with core-dev before slice 2

- **`index`/`event` as own kinds vs nested in the table** — recommendation: **own kinds** (matches the
  graph ordering + keeps the table kind's portable form small). Push back if your dialect makes nesting
  cleaner.
- **Substrate line:** where exactly "neutral field/type vocabulary" ends and "kind" begins — a table's
  fields use `PortableField`/`PortableType` unchanged; only the table-level structure moves into the
  kind. Raise any field-shape needs (clauses you carry verbatim) so we keep them in the substrate.
- **`overwrite` granularity:** the spine compares whole-object `emit` strings to detect change, then
  calls `overwrite(prev, next)` once per changed object. If you need *clause-level* sub-diffing inside
  one object (e.g. ALTER only the changed field), do it **inside** `overwrite` (slice 1's table kind
  shows the pattern). Tell core-dev if you need finer hooks.

**Questions / contract changes → DM `core-dev`** (per the repo's bridge rules). I'll fold confirmed
decisions back into this doc and `kind-registry.md`.
