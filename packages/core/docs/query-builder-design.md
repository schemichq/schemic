# @schemic/core Query Builder — Design Exploration

> Status: **research + design + feasibility proof**. Nothing here is built into the
> package. The companion POC under [`poc/`](./poc/query-builder-poc.ts) proves the
> core type-inference mechanism compiles (`bunx tsc --noEmit -p tsconfig.json`).

---

## 1. Goal & positioning

Build a **type-safe SurrealQL query builder** on top of @schemic/core's `s` schemas
and codecs, with the explicit goal of **replacing the official `surqlize` ORM**.

Targets:

- **Full SurrealQL parity** — queries (`SELECT`/`CREATE`/`UPDATE`/`UPSERT`/`DELETE`/
  `RELATE`/`INSERT`), `LET`, transactions, `LIVE SELECT`, graph traversal, the
  standard function library, and `DEFINE`/admin statements.
- **End-to-end type safety + autocomplete** — table/field names, operators, graph
  edges, and projections are all inferred and completed.
- **Single source of truth.** The `s` table definition already drives DDL
  generation (`defineTable`) *and* JS↔DB codecs. The query builder becomes the
  third consumer of the same definition — no parallel type system.

### Our differentiator vs surqlize

surqlize defines a **parallel** type system (`t.string()`, `t.date()`, …) that is
*only* a query/validation model. @schemic/core's `s.*` is a **Zod schema +
SurrealQL DDL metadata + codec**, so:

| Capability | surqlize | @schemic/core builder |
|---|---|---|
| Schema authoring | `t.*` (query-only) | `s.*` (Zod, also drives DDL + codecs) |
| Read results | validated against `t.*`, dates via ad-hoc `DateType.parse` | **decoded through Zod codecs → real `App` types** (`Date`, `string`-from-`Uuid`, `RecordId`, `Decimal`, `Duration`, `bytes`…) |
| Writes | plain values | encoded through codecs (`App` → wire) |
| DDL | none | shared `defineTable` from the same def |
| Validation | hand-written `validate()` per type | Zod (refinements, formats, transforms) |

The headline: **a `select(...)` with no projection returns `App<typeof Table>[]`** —
the exact decoded type your app code already uses — for free.

---

## 2. How surqlize does it (concrete inference patterns)

surqlize achieves end-to-end inference with four cooperating layers. References are
`~/git/github.com/surrealdb/surqlize/src/...`.

### 2.1 A phantom-typed value model — `AbstractType`
Each runtime type class carries a phantom `infer` field that holds its TS type, and
a `.get(prop)` that returns the child type + idiom path segment.
- `types/classes.ts:22-44` — `AbstractType<T>` with `infer = undefined as unknown as T` and `get()`.
- `types/classes.ts:258-316` — `ObjectType<T>` whose `infer` maps `{ [K]: T[K]["infer"] }`, and whose `.get(prop)` returns `[this.schema[prop], ".prop"]`.
- `types/classes.ts:202-255` — `RecordType<Tb>` (→ `RecordId<Tb>`) and `GraphType<Tb>` (→ `RecordId<Tb>[]`, carries the landed table on `.tb`).

### 2.2 The chain carrier — `Workable` + `Actionable`
A `Workable` is a 3-symbol triple: render fn, type, context.
- `utils/workable.ts:9-16` — `Workable<C, T> = { [__display], [__type]: T, [__ctx]: C }`.
- `utils/workable.ts:46-57` — `workableGet` threads field access through `AbstractType.get`, building the idiom path *and* narrowing the type.
- `utils/actionable.ts:23-66` — `Actionable<C,T> = ActionableProps<C,T> & Workable<C,T> & GetFunctions<C,T>`, implemented as a **Proxy**. `ActionableProps` maps an `ObjectType`'s fields to nested `Actionable`s, so `user.address.city` is typed and renders `address.city`. This is the autocomplete surface inside callbacks.

### 2.3 Result re-typing — `.where` / `.return`
- `query/select.ts:124-129` — `SelectQuery<O, C, T, E = O["tables"][T]["schema"]>`; `E` is the per-row `AbstractType`, result is `ArrayType<E>`.
- `query/select.ts:202-220` — `.return(cb)` runs `cb` with an `Actionable` row, captures the returned shape `P`, converts it to a new `AbstractType` via `InheritableIntoType`, and returns `SelectQuery<O, C, T, R>` — i.e. the projection **re-types the whole query**.
- `utils/inheritable.ts:35-45` — `InheritableIntoType` walks the returned object/array of `Workable`s back into an `ObjectType`/`ArrayType`, so `{ a: u.name }` → `ObjectType<{ a: StringType }>`.
- `query/select.ts:222-235` — `.where(cb)` takes `cb: (row) => Workable<C>` (a boolean expr) and does **not** change the result type.

### 2.4 The function library — `GetFunctions`
- `functions/index.ts:33-58` — `GetFunctions<C,T> = any-functions & (T["name"] extends keyof BaseFunctions ? BaseFunctions[T["name"]] : fallback)`. The base type's `name` ("string"/"number"/…) selects which method bundle is mixed into the `Actionable`.
- `functions/types/string.ts:18-740` — each function is a method with a `this: Workable<C, StringType>` receiver returning `Actionable<C, BoolType|StringType|…>`; the runtime `functions` object and the `Functions` *type* are kept in lockstep via `satisfies`. ~25 namespaces are hand-written this way.
- `schema/function.ts:41-115` — user `DEFINE FUNCTION`s: `fn(name, [params], ret)` returns a `FunctionCallable<P,R>` usable both inside queries and via `db.run`.

### 2.5 Graph traversal
- `schema/edge.ts:43-114` — `EdgeSchema<From, Tb, To, Fd>` records endpoints in the type.
- `schema/traversal.ts:74-153` — `RowTraversal` adds `.out/.in/.outEdge/.inEdge`; `OutgoingEdges<C,Tb>`/`IncomingEdges<C,Tb>` scan all registered edges for ones whose `from`/`to` is `Tb` (so `.out("...")` only completes valid edges), and `ToOf`/`FromOf` resolve where the hop lands. `RecurseOpts` (`schema/traversal.ts:49-66`) types depth/`collect`/`shortest`.
- `.out(...)` yields `Actionable<C, GraphType<To>>`; passing that to `db.select(step)` (`schema/orm.ts:102-105`) re-roots a new query at the target table.

### 2.6 FETCH (link expansion)
- `query/select.ts:45-118, 319-338` — `FetchPaths<O,T>` constrains the head segment to a real field; `FetchedSchema`/`ResolveLink` rewrite fetched `RecordType<Tb>` fields into the *referenced table's* `ObjectType`, recursing for dotted paths. This is the closest analog to what our codecs must do for reads.

### 2.7 Live queries
- `query/live.ts:118-258` — `LiveQuery<O,C,T,E,V>` mirrors `SelectQuery` but the awaited value is a `LiveSubscription<V>` (`live.ts:57-97`) delivering typed `LiveMessage<V>` notifications; `.diff()` swaps `V` to `JsonPatchOp[]`.
- `query/abstract.ts:20-157` — base `Query` is a thenable; `.execute()` renders, runs `surreal.query`, and `parseResult`s through the runtime type.

### Verdict — reuse vs change

**Reuse conceptually:**
- The **`Workable`/`Actionable` Proxy** pattern for callback rows (idiom-path building + typed field access + a function mixin). It is the cleanest known way to get autocomplete inside `where`/`return`.
- The **callback-projection → re-type-the-query** trick (`InheritableIntoType`).
- The **edge-scanning** approach to graph-direction typing (`OutgoingEdges`).
- The **chained-generic** builder (`SelectQuery<…, E>` threading the row type).

**Do differently:**
- **Drive everything from `s`/`TableDef`, not a parallel `t.*`.** Field types come
  from the table's `ZodObject` (`pure.ts:497-509`), not from `AbstractType`.
- **Results decode through codecs.** Where surqlize calls `AbstractType.parse`, we
  call `TableDef.decode` / a per-projection Zod codec so reads return real `App`
  types (`pure.ts:515-529, 729-735`). A bare `select` returns `App<T>[]` with zero
  projection code.
- **Replace `AbstractType.get`/`infer` with Zod-derived field walking.** We map over
  `z.output<TableDef["object"]>` to build the row (see POC §2), and we need a small
  "Zod type → child Zod type + idiom path" resolver for nested/array/link access
  (the analog of `ObjectType.get`).
- **Links resolve via `RecordIdField.tables`** (`pure.ts:229-273, 606-614`) and
  `relation().from().to()` (`pure.ts:720-726`) instead of `EdgeSchema` — the edge
  metadata already lives on our defs.

---

## 3. Proposed architecture

```
s.table(...) ─► TableDef<Name, Shape>           (already exists)
                   │  .object : ZodObject         → App<T> = z.output<.object>
                   │  .decode/.encode (codecs)    → wire ↔ App
                   ▼
   orm(db, ...defs)            registry: { [name]: TableDef }  + edge adjacency
                   │
                   ▼
   select(name) ─► Select<TD, R = App<TD>>        result element type R, query → R[]
                   ├─ .where(row => Expr)          row: Row<TD>; result unchanged
                   ├─ .return(row => P)            re-types: Select<TD, Unwrap<P>>
                   ├─ .fetch("link"...)            Row link field → resolved App
                   ├─ .orderBy/.limit/.start/...   result unchanged
                   └─ await / .run()               decode(rows) → R[]
```

### Core types (validated by the POC)

- **`Row<TD>`** — `{ [K in keyof App<TD>]: FieldRef<App<TD>[K]> }`. Built from the
  *decoded* app type, so `createdAt` is `FieldRef<Date>`, `id` is
  `FieldRef<RecordId<"user">>`. In the real builder `FieldRef` is the
  `Workable`/Proxy carrying the idiom path; here it is a typed stub.
- **`FieldRef<T>`** — phantom `_type: T` + the operator/function surface
  (`eq/gte/contains/...`). The function mixin is selected from the field's Zod base
  kind (string/number/array/…), mirroring `GetFunctions`.
- **Projection inference** — `.return(cb)` captures `P` and applies
  `Unwrap<P>` (`FieldRef<U> → U`, recursing into nested objects). This is the direct
  analog of `InheritableIntoType`.
- **Result decoding** — `R` is always the *decoded* type. The runtime builds a
  projection Zod schema from the selected `FieldRef`s and runs `z.decode`, exactly
  like `TableDef.decode` does for the full row.

### Where-clause expression typing
`where(cb: (row: Row<TD>) => Expr)`. Operators live on `FieldRef<T>` and are typed
per base kind: comparisons on all (`=`,`!=`,`<`,`<=`,`>`,`>=`), containment on
arrays (`CONTAINS`, `IN`, `CONTAINSALL`), `~`/`@@` on strings, `<|k|>` on vectors.
`and(...)`/`or(...)`/`not(...)` combine `Expr`s. RHS values are typed as the field's
**app** type and encoded on render.

### Graph traversal typing
Reuse the edge-scan pattern but source it from `relation()` defs: `OutgoingEdges<O,Tb>`
= relations whose `from` includes `Tb`. `row.out("member")` → `FieldRef<RecordId<to>[]>`
(or, with `.fetch`, the resolved `App`). `select(row.out("member"))` re-roots.

### Function-call typing
A `fn` namespace (`fn.string.lowercase(ref)`, `fn.time.now()`, …) where each entry
is typed `(args) => FieldRef<Ret>`, generated to parity. User functions: a
`defineFunction(name, [paramSchemas], retSchema)` returning a typed callable, with
`retSchema` an `s` field so the result decodes.

---

## 4. Hardest type-level problems

| # | Problem | Approach | Risk |
|---|---|---|---|
| 1 | **Zod type → child type + idiom path** (nested object/array/link access in callbacks). surqlize gets this free from `AbstractType.get`; we must derive it from Zod internals. | A `FieldOf<ZodType, Key>` mapped type over `z.output`, plus a runtime walker reading `schema._zod.def` (already done in `ddl.ts:inferField`). | **Med.** Zod v4 `_zod.def` is semi-internal; nested optional/array unwrapping is fiddly but `pure.ts`/`ddl.ts` already do it. |
| 2 | **Typing the function library at parity** (~25 namespaces, hundreds of fns). | Hand-write like surqlize, or codegen from the SurrealQL function list. Map each return to an `s` field so results decode. | **Med (volume, not depth).** Mechanical but large; biggest single time sink. |
| 3 | **Expressions in TS** — modeling SurrealQL's operator/precedence surface as composable typed `Expr`s. | Keep `Expr` opaque (boolean); operators are methods on `FieldRef` + free `and/or/not`. Don't model precedence in types — render with parens. | **Low–Med.** Pragmatic; full operator coverage is breadth. |
| 4 | **Recursion / inference depth** — graph recursion (`{..}`, shortest-path), deeply nested FETCH, self-referential links (`task.depends_on.task`). | Bound recursion depth in conditional types; degrade to `RecordId[]`/`unknown` past a limit (surqlize does this — `FetchPaths` only constrains the head). | **Med–High.** TS instantiation-depth (the `Type instantiation is excessively deep` ceiling) is the classic wall for graph recursion. |
| 5 | **Inference performance & autocomplete quality** | Cache `App<TD>`/`Row<TD>` via interface merging; avoid gratuitous distributive conditionals; prefer mapped types over recursive ones. | **Med.** Large schemas × the Proxy mixin can make hovers slow; needs profiling (`tsc --extendedDiagnostics`). |
| 6 | **RecordId / link traversal typing through codecs** | `RecordIdField.tables` gives the target table name(s); resolve to the registered `TableDef` and recurse for `.fetch`. Multi-table links → union. | **Med.** Unions of link targets and `option<…>`/`array<…>` wrappers multiply cases. |
| 7 | **Projection decode at runtime** — a projection isn't a full table row, so `TableDef.decode` rejects it. | Build an ad-hoc `z.object` from the selected `FieldRef`s' source schemas and decode that (surqlize's `.return` precedence note, `select.ts:170-180`, is the same problem). | **Low.** Mechanical. |

**The single hardest:** **#4 (recursion/inference-depth for graph + nested FETCH).**
Mitigation: cap traversal/fetch depth in the type machinery (e.g. depth ≤ ~4) and
fall back to `RecordId<…>[]`/`unknown` beyond it — exactly what surqlize does by
constraining only the *head* of a fetch/idiom path and leaving the tail `string`.
This keeps common cases fully typed without hitting TS's instantiation ceiling.

---

## 5. Parity checklist

Legend: ✅ MVP · 🔶 later · 🔴 hard.

### Statements
- ✅ `SELECT` (FROM table/record/range), `WHERE`, `LIMIT`/`START`, `ORDER BY`,
  `GROUP BY`/`GROUP ALL`, `SPLIT`, projections (`.return`), `VALUE`
- ✅ `CREATE`, `UPDATE` (CONTENT/MERGE/PATCH/SET), `DELETE`, `UPSERT`, `RETURN ...`
- ✅ `INSERT` (+ `ON DUPLICATE KEY UPDATE` 🔶)
- ✅ `RELATE` (typed by `relation().from().to()`)
- ✅ `LET` / params, subqueries
- 🔶 `BEGIN`/`COMMIT`/`CANCEL` transactions, batch
- 🔶 `LIVE SELECT` (+ `DIFF`), `KILL`
- 🔶 `FETCH` link expansion
- 🔶 graph traversal `->`/`<-`, `.out/.in/.outEdge/.inEdge`
- 🔴 recursive idioms `{depth}`, `+collect`, `+shortest`
- 🔶 `DEFINE TABLE/FIELD/INDEX/EVENT/FUNCTION/ANALYZER/ACCESS` (partly exists: `defineTable`/`defineField` in `ddl.ts`)
- 🔶 `INFO`, `SHOW`, `REMOVE`, `ALTER`, `REBUILD`, `USE`, `ACCESS`
- 🔶 control flow `IF ELSE`, `FOR`, `RETURN`, `THROW`, `BREAK`/`CONTINUE`, `SLEEP`

### Expressions / operators
- ✅ comparison (`=`,`==`,`!=`,`<`,`<=`,`>`,`>=`, `IS`/`IS NOT`)
- ✅ logical (`&&`/`AND`, `||`/`OR`, `!`, `??`, `?:`)
- 🔶 containment/set (`CONTAINS*`, `INSIDE`/`IN`, `ALLINSIDE`, `ANYINSIDE`…)
- 🔶 arithmetic (`+ - * / **`)
- 🔴 full-text `@@`, KNN `<|k|>`, geometry `OUTSIDE`/`INTERSECTS`, `?=`/`*=`

### Function library (~27 namespaces)
- 🔶 array, string, math, time, type, object, record, count, parse, rand, duration
- 🔶 crypto, encoding, meta, session, value, set, geo, search, sequence, bytes, file
- 🔴 vector, http, api, not (volume + a few exotic signatures)

### Codec-typed reads/writes (our differentiator)
- ✅ decode reads → `App` (Date/uuid-string/RecordId/Decimal/Duration/bytes)
- ✅ encode writes (`make`/`makePartial` already exist, `pure.ts:546-553`)

---

## 6. Phased roadmap to replace surqlize

| Phase | Scope | Rough effort |
|---|---|---|
| **0. Spike** | `orm(db, ...defs)` registry + `Row`/`FieldRef`/projection inference (this POC, productionized) | 1 wk |
| **1. MVP read** | Typed `SELECT` + `where` + projection, `orderBy/limit/start`, **decoded results**, awaitable execute | 2–3 wk |
| **2. CRUD writes** | `CREATE`/`UPDATE`/`UPSERT`/`DELETE`/`INSERT`, `RETURN`, codec-encoded inputs (reuse `make`/`makePartial`) | 2 wk |
| **3. Graph** | `relation`-driven `.out/.in/.outEdge/.inEdge`, `RELATE`, `FETCH` (bounded depth) | 3–4 wk |
| **4. Functions** | `fn.*` library to parity + `defineFunction`; operator coverage | 4–6 wk (codegen helps) |
| **5. Live** | `LIVE SELECT` (+`DIFF`), typed subscriptions/notifications, `KILL` | 1–2 wk |
| **6. DEFINE/admin** | Wrap existing `ddl.ts` generation as statements; `INFO`/`REMOVE`/`ALTER`/transactions | 2–3 wk |

**Total ≈ 4–6 focused months** for credible parity. Phases 1–2 alone are an
immediately useful, differentiated product (decoded results that surqlize can't
match).

---

## 7. Decisions

**Locked (2026-06-06):**
- **Decoding:** decode by default → `App` types via codecs; `.raw()` opts out per query.
- **Entrypoint:** free functions are primary — `select(db, Table)…` (works with any db at any time, tree-shakeable). PLUS an optional registry that *binds* a db and re-exposes `newSession()`/`forkSession()` from the underlying Surreal session. Rejected `orm(db, ...defs)`: the `...defs` spread doesn't scale, and schemas already come from the `TableDef` passed to `select()`.
- **Boundary:** a `@schemic/core/orm` subpath export (opt-in, keeps core lean).
- **Status:** design committed; **build deferred** — finish other backlog first.
- **Still open:** function-library parity strategy (hand-write vs codegen from the SurrealQL function index) — a Phase-4 call.

### Original open questions (rationale)

1. **API style / fluency.** Mirror surqlize's fluent `db.select("user").where(...).return(...)`
   closely (eases migration), or design a fresh ergonomic API? Recommendation:
   **mirror it** for migration, but address tables by the `TableDef` object
   (`select(User)`) for tighter inference rather than by string name.
2. **Runtime result validation.** Always `z.decode` results (safe, catches drift,
   costs CPU + can throw on schema mismatch), or offer a **type-only / `safeDecode`**
   mode? Recommendation: **decode by default, opt-out per query** (`.raw()`).
3. **Single entrypoint.** Expose one `orm(db, ...schemas)` (surqlize-style) or free
   functions (`select(db, User)`)? Recommendation: **`orm(db, ...defs)`** so edge
   adjacency / param scoping has a home.
4. **Function-library parity strategy.** Hand-write (full control, large) vs codegen
   from the SurrealQL function index (faster, needs a generator)? Affects phase-4
   effort the most.
5. **Naming / package boundary.** New subpath (`@schemic/core/query`) or separate
   package? And builder result default — `App[]` vs single-record helpers
   (`.one()`/`.val()`).

---

## 8. Feasibility verdict

**Realistic — with scoping.** The load-bearing mechanism (drive a fluent builder
from an `s` table and infer the **decoded** result type, including projections and
codec types) **compiles today** — see the POC. Reads returning real `App` types are
a genuine, shippable edge over surqlize that falls out almost for free.

"Full parity" is a **breadth** problem, not a feasibility one — the hard *type*
problems (graph recursion depth, FETCH) are exactly where surqlize already
pragmatically degrades, and we can copy that posture. The realistic cost is
**~4–6 months** to credible parity; **Phases 1–2 (~1–1.5 months)** already ship a
differentiated product. The two real risks are **(a)** function-library volume and
**(b)** TS inference performance/instantiation-depth on deep graph types — both
manageable with codegen and bounded recursion.
