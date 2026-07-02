# Proposal: table composition + derived input/output schemas (DevEx)

**Status:** design proposal (driver-dev-surrealdb). **Date:** 2026-07-02.
**Motivates:** the DevEx-lens principle in CLAUDE.md — the authoring surface IS the product, so
composing tables from reusable column sets and deriving validation schemas must be first-class, not a
job that forces users into our internals.
**Grounded in real usage:** a Schemic user (gulybyte) built a `tenantTableSchema(...)` helper (tenant +
`createdAt`/`updatedAt` + soft-delete `deletedAt` base columns + tenant policies/events) and a
`customerInput` validation schema. Both are forced into workarounds by gaps below.

## 1. The gaps (with code evidence)

### G1 — no way to build a table from an `s.object()`, or to recover its field map
`defineTable` **rejects the object form at compile time** (`pure.ts:3010` — the `shape` param is
`Shape | ((self) => S)`, and the object form is rejected by `RejectNoDdl`/`RejectBadId`). And there is
**no public way to get the SField map back out of an `s.object()`**: `SObjectField.fields` is
`private` (`pure.ts:1425`), and the public `.shape` (`pure.ts:1505`) returns `ZShape` — the *Zod*
schemas, not the SFields — so it can't be spread into `defineTable`.

Result: a user who wants to accept `s.object()` inputs must reach into our **internal**
`objectFieldsRegistry`:
```ts
// gulybyte's tenantTableSchema — the unwrap workaround:
"schema" in table
  ? (objectFieldsRegistry.get(table.schema) ?? {})   // internal registry, keyed by the ZodObject
  : (table as Shape)
```
That registry is technically exported but is a low-level implementation detail keyed by `.schema` —
a leaky abstraction for the everyday "give me this object's fields."

### G2 — no *typed* table composition (`as never` casts)
Merging reusable columns into a table fights the type guards:
```ts
defineTable<Name, S & MetaShape & { id: RecordIdField<Name> }>(tableName, {
  ...shape,
  ...getMetaColumns(),
} as never)   // <- forced: RejectNoDdl<S>/RejectBadId<S> don't compose over a spread
```
There is no typed path to "extend a table's shape with more columns," so programmatic composition
(base columns + table fields) needs `as never`. (`& { id: RecordIdField<Name> }` is also redundant —
`defineTable` already returns `WithSmartId<Name, S>`.)

### G3 — input schemas are modeled but not *exposed* as composable schemas
The create/update semantics are precise but live only as **types** (`CreateShape<S>` / `UpdateShape<S>`,
`pure.ts:2402+`) plus codec **methods** (`encode`/`encodePartial`/`safeEncode`). The **output/row**
schema IS exposed as a real object (`table.object`, with `.decode()`), but there is **no standalone
create-input / update-input Zod schema** a user can `.partial()/.extend()/.refine()/.union()`.

So users hand-roll it — and get it subtly wrong:
```ts
export const customerInput = s.union([
  s.object(customerSchema),                                   // BUG: requires `creditEnabled`
  s.object(customerSchema).partial().extend({ id: s.string() }),  //      even though it has $default(true)
]).refine(/* balance rule */)
```
`s.object(customerSchema)` requires every field, but `creditEnabled: s.boolean().$default(true)` should
be **optional on create** (the DB fills it). Our `CreateShape` already models exactly this (`CreateOptional`);
the hand-roll re-implements it and drifts.

## 2. Proposal

**P1 — accept `s.object()` + expose the field map.** `defineTable(name, obj)` accepts an `s.object()`
(unwrap internally, no registry poke) alongside the existing `Shape` / `(self) => S` forms. Add a public
accessor to recover the SField map from an object — either a public `.fields` getter or a
`s.toFields(obj)` util — so composition never needs the internal registry.

**P2 — typed table composition.** `TableDef.extend(shape | s.object())` returns a new `TableDef` with the
merged, correctly-typed shape (no `as never`). This makes base-column *mixins* first-class:
```ts
const meta = { tenant_id: …, createdAt: …, updatedAt: …, deletedAt: … };
defineTable("customer", customerFields).extend(meta)        // typed, cast-free
```
(Optionally a `baseColumns(...)` / mixin helper, but `.extend` alone covers gulybyte's case.)

**P3 — derived, Standard-Schema getters on `TableDef`** (composable — `.partial/.extend/.refine/.or`):
- `table.object` — full row/output (already exists).
- `table.insert` (a.k.a. `.create`) — the `CreateShape`: internal fields dropped, `$default`/`id` optional.
- `table.update` (a.k.a. `.patch`) — the `UpdateShape`: partial, `id`/readonly excluded.

## 3. Worked example (before → after)

```ts
// BEFORE (gulybyte, today): unwrap via internal registry + `as never`; hand-rolled, buggy input.
export function tenantTableSchema(name, table) {
  const shape = "schema" in table ? (objectFieldsRegistry.get(table.schema) ?? {}) : table;
  return defineTable(name, { ...shape, ...getMetaColumns() } as never).schemafull()./*…*/;
}
export const customerInput = s.union([
  s.object(customerSchema),
  s.object(customerSchema).partial().extend({ id: s.string() }),
]).refine(/*…*/);

// AFTER (with P1–P3):
export function tenantTableSchema(name, table) {
  return defineTable(name, table).extend(getMetaColumns()).schemafull()./*…*/;  // accepts s.object(); no cast
}
export const customerInput = customer.insert
  .or(customer.update.extend({ id: s.string() }))                               // correct: creditEnabled optional
  .refine(/*…*/);
```

## 4. Cross-driver + ownership

This is **not** surreal-only: `@schemic/postgres` wants the identical surface (it's already `$`-only /
Standard-Schema). The **naming** (`.insert`/`.update`/`.object`, `.extend`, `.fields`/`toFields`) should
be a **neutral convention** aligned with `core-dev` so both drivers match — not a surreal bolt-on that
postgres later has to reconcile. Each driver implements against its own `TableDef`/field types
(surreal's `pure.ts`, postgres's `authoring.ts`), but the shape/names are shared.

Relates to the "create-input" item already in the pure backlog. Suggested build order once naming is
ratified: **P1** (accept object + `.fields`) → **P2** (`.extend`) → **P3** (derived schemas), each a
self-contained, backward-compatible addition.

## 5. Open questions for core-dev
1. Getter names: `.insert`/`.update`/`.object` vs `.create`/`.patch`/`.row` — pick one neutral set.
2. `.fields` public getter vs a standalone `s.toFields(obj)` util (or both).
3. Should `.extend` live on `TableDef` only, or also compose two `s.object()`s (it already has
   `SObjectField.extend` at `pure.ts:1444` — reuse the shape).
4. An `.upsert` combinator (`insert | update+id`) as a first-class helper, or leave users to `.or()`?
