# Kind Registry — exploration

> Status: **exploration** (branch `explore/kind-registry`, off the converged `feat/multi-connection`).
> Nothing built into a package. Companion compiling spike: [`poc/kind-registry.poc.ts`](./poc/kind-registry.poc.ts)
> (proves the crux under `--strict`).

## 1. The idea

Make `@schemic/core` a **generic kinded-definable engine**. Core stops hard-coding the *object kinds* a
schema can contain (`table`/`field`/`index`/`event`/`function`/`access`). Instead, each driver
**registers KINDS**, and each kind brings:

- its **own authoring builder** — any shape/chain it likes, fully typed (`defineTable("u", {…})`,
  `defineFunction(…).returns(…).body(…)`); and
- its **engine behavior** — `lower` / `diff` / `emit` / `introspect` over *that kind's* objects.

Core orchestrates **generically over the registry** — it never names `"table"`. What core keeps owning
is the **field/type vocabulary** (`SFieldBase`, the Zod-drop-in `s.*`, `PortableType`, codecs) — the
*substrate* every kind builds on. That substrate is exactly what makes the Zod drop-in + the cross-driver
field model work, so it stays central (Manuel: keep it).

## 2. What it actually changes (it's smaller than it sounds)

A fact about the current code: **core already doesn't "do" tables.** Structural behavior
(`lower`/`diff`/`emit`/`introspect`) is *already* the driver's job; the portable IR is just the shared
**data shape**, and that shape has **fixed slots**:

```ts
// today:
interface PortableDb { tables: PortableTable[]; functions: PortableFunction[]; accesses: PortableAccess[]; natives?: … }
interface Driver { lower; diff; emit; introspect; … }   // whole-DB methods that internally switch on slot
```

The kind registry turns those **fixed slots into a registry**, and the whole-DB methods into **per-kind
handlers**:

```ts
// proposed:
type PortableDb = { kinds: Record<string, PortableObject[]> }     // generic, open
// a Driver = a SET of registered kinds; core loops the registry (see §4)
```

The two-tier model we already have — *structured* (`tables/fields/indexes`, core understands the shape)
vs *opaque-`native`* (`events/functions/accesses`, core just round-trips) — becomes **one uniform
mechanism**: a kind decides for itself how structured its portable form is.

## 3. The two layers

1. **Shared substrate (core owns, stays neutral):** `SFieldBase` + the Zod-drop-in `s.*` + `PortableType`
   + codecs. Fields/types are **not a kind** — they're the cross-cutting vocabulary kinds *use* (a table
   has fields; a function's args are fields; an index references fields).
2. **Kind registry (core provides the mechanism, drivers populate):** `createKind({ name, build, lower,
   diff, emit, introspect })`. The migration spine iterates registered kinds.

## 4. `createKind` — the primitive (DX is the driver's, preserved)

The key worry was "a generic factory can't produce `defineTable`'s vs `defineFunction`'s different rich
builders." It doesn't have to — **the driver writes its own builder; `createKind` passes its type
through unchanged** and just registers the engine behavior:

```ts
function createKind<Build extends (...a: never[]) => unknown, A extends Authored, P extends PortableObject>(
  spec: { name: string; build: Build } & KindEngine<A, P>,
): Build { REGISTRY.set(spec.name, spec); return spec.build; }
```

**The POC proves the generics survive the passthrough** (TS keeps a generic function's parameters when it
flows through `<Build extends Fn>(…): Build`). So:

```ts
export const defineTable = createKind({
  name: "table",
  build: <Name, S>(name: Name, fields: S) => ({ kind: "table", name, fields, permissions() {…} }),  // shape + modifier
  lower, diff /* field-level */, emit,
});
export const defineFunction = createKind({
  name: "function",
  build: <A>(name, args) => ({ returns: r => ({ body: make => ({ kind: "function", name }) }) }),     // multi-stage chain
  lower, diff /* whole-object */, emit,
});
```

`defineTable("user", {…})` infers its full `TableDef` (typed field access); `defineFunction(…).returns(…)
.body(…)` keeps its chain typed (body args typed). Type-safety + DX are **the driver's design**, not
something `createKind` constrains.

Core orchestrates with no kind knowledge:

```ts
function plan(prev: Authored[], next: Authored[]): string[] {
  const ddl = [];
  for (const [kind, engine] of REGISTRY) {                 // ← loops kinds, never names one
    const lower = ds => ds.filter(d => d.kind === kind).map(engine.lower);
    const prevByName = new Map(lower(prev).map(p => [p.name, p]));
    for (const n of lower(next)) ddl.push(...engine.diff(prevByName.get(n.name), n));
  }
  return ddl;
}
```

## 5. What core still owns

- **The field/type vocabulary** — `SFieldBase`, `s.*` Zod-superset (conformance-enforced), `PortableType`,
  codecs. *The substrate.*
- **The migration spine** — the generic snapshot format (`kinds` map), the diff/plan loop over kinds,
  migration bookkeeping, the CLI orchestration, connection/capability contracts.
- **The kind-registry primitive** (`createKind`) + the Driver-as-set-of-kinds contract.

Everything *object-kind-specific* moves to the drivers.

## 6. Wins

- **New schema-object kinds = "register a kind", zero core change.** Directly kills the
  definable-coverage backlog: SurrealDB `ANALYZER`/`PARAM`/`USER`/`MODEL`, Postgres
  `EXTENSION`/`DOMAIN`/`ENUM`/`SEQUENCE` become `createKind` calls, not new `PortableDb` slots + engine
  special-cases.
- **Capability-gating falls out for free** — a driver that doesn't register a kind simply doesn't have it
  (Redis: no `defineFunction`). Same philosophy as the query-layer `callable` + the conformance suite:
  the *contract* is the gate, never `if surreal`.
- **Smaller, more honest core** — a generic engine + the field/type substrate; no per-object code.
- **Uniform authoring** — every definable is `define<Noun>` over one `createKind`, per the §spec's
  `define`-prefix + driver-owned-vocabulary decisions.

## 7. Hard parts / open questions

1. **Cross-kind dependency ordering.** The single biggest one — worked out in
   [`poc/kind-ordering.poc.ts`](./poc/kind-ordering.poc.ts) (compiles + runs).
   - **A per-kind ordinal is NOT enough.** "Tables, then indexes, then functions" breaks the moment a
     table's **event calls a function** — that function must be emitted *before* the table, i.e. a
     FUNCTION before a TABLE, which a tables-first ordinal gets exactly wrong. Dependencies don't respect
     kind layers. (Same with intra-kind deps: a graph-edge table referencing its in/out tables, a
     function calling another function.)
   - **Use a dependency GRAPH + topological sort.** Each kind engine declares, per object,
     `deps(portable): Ref[]` — the specific objects it must come after (a field/index → its table; an
     edge table → its in/out tables; an event → its table + any function it calls; a search index → its
     analyzer). Flatten all objects across kinds, topo-sort (DFS post-order); a cycle is a named error.
   - **The ordinal survives only as a TIE-BREAK** among objects with *no* dependency relation — so
     independent objects come out stable and layered (readability), but it never overrides the graph.
   - **Drops reverse the order** (drop the FK side before the table; drop a table's event before the
     function it calls). One sort serves both directions.
   - **Grouping (`DEFINE INDEX` right after its `DEFINE TABLE`) is a separate READABILITY pass**, not
     correctness. Model it with an optional `owner(portable): Ref` (a field/index/event's table) and
     cluster owned objects next to their owner *within* what the topo order permits — but correctness can
     force a function ahead of a table (the event case), so grouping yields to the graph.
   - This is also the backlog's "edge-aware dependency topo-sort across definable types" — the registry
     forces us to finally solve it properly, once, for every kind.
2. **Snapshot format v2 → v3.** `PortableDb` fixed slots → `{ kinds: Record<string, PortableObject[]> }`.
   A read-compat upgrade (like the v1→v2 we already did via `Driver.upgradeSnapshot`).
3. **Type-erasure boundary.** The registry holds `KindEngine<any, any>` (heterogeneous kinds erase at the
   engine seam — engine ops are structural). The *authoring* side keeps full types (the `build` return).
   So erasure is only at the engine boundary, exactly like `Conn`/`Authored` are opaque in the Driver
   contract today. (POC does this.)
4. **Introspect (reverse).** `KindEngine.introspect(conn): P[]` per kind — but introspection is often one
   `INFO`/`pg_catalog` read that yields *all* kinds at once. Likely a driver-level `introspectAll(conn)`
   that fans out into per-kind objects, rather than N independent reads. Settle when wiring a driver.
5. **Fields/types are substrate, not a kind** — confirmed (§3). The boundary between "neutral field/type
   vocabulary" and "kind" needs a crisp line so kinds compose fields without re-inventing them.
6. **Diff plan assembly.** Per-kind `diff` returns changes; the spine must interleave them by dependency
   (create parents before children across kinds; drops in reverse) — ties back to (1).

## 8. Incremental path (don't rewrite the working engine at once)

The converged multi-DB engine works today; migrate **kind-by-kind, green at each step**:

1. Land `createKind` + the registry + a generic `plan`/snapshot *alongside* the current fixed-slot engine.
2. Move ONE kind (`function`, already the opaque-`native` pattern → lowest risk) onto the registry; prove
   parity.
3. Move `access`/`event` (also opaque). Then the structured ones (`index`, then `table`/`field`).
4. Solve cross-kind ordering (§7.1) before/with the structured kinds.
5. Retire the fixed slots last; flip the snapshot to v3.

`native` is already the opaque-kind pattern, so the engine is *half* this design already — the registry
just makes it uniform + first-class.

## 9. Relationship to the query layer

Complementary: in [`query-layer-spec.md`](./query-layer-spec.md), `defineFunction` is exactly a **kind**,
and the `callable` capability (invoke + render `PortableQuery`) is **behavior the `function` kind carries**.
So the query layer is a *consumer* of this model — another reason kinds should own their full surface
(authoring builder + engine + runtime capability) under the shared field/type substrate.
