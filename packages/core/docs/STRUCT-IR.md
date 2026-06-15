# Struct-IR — the unified normal form (DRAFT for review)

Status: **draft, not yet implemented.** Reviewers: `@database-expert` (canonical-form), the maintainer.

## Goal

One structured normal form that **both** the offline schema side and the live DB lower into, so
diffing is a deterministic deep-compare and rendering (TS / DDL) reads off the same shape. No
SurrealQL DDL parsing anywhere.

```
TableDef (TS)  ──fromTableDef()──┐
                                 ├──► Struct ──normalize()──► Struct(normal)
INFO STRUCTURE ──fromInfo()──────┘                              │
                                                  equality = deep-compare
                                                  render:  Struct → TS   (pull renderer)
                                                           Struct → DDL  (canonical emitter)
```

`fromInfo()` already exists as `introspectStructured()` (it returns `StructTable[]`). `fromTableDef()`
is the new keystone. `normalize()` is factored out of today's `canonical*` DDL functions so it
operates on the Struct, not on DDL strings.

## The shape (reuse + lightly extend today's `structure.ts`)

The IR is the existing `StructTable` / `StructField` / `StructIndex` / `StructEvent` /
`StructFunction` / `StructAccess` (see `src/cli/structure.ts`). Field clauses are already separated
data; only `kind` stays a SurrealQL type expression string (parsed by the renderer, normalized by
`normalize`). Both lowerings must populate these identically.

```ts
StructField {
  name: string          // dotted path: "email", "address.city", "tags.*"
  kind: string          // SurrealQL type expr: "string", "option<int>", "array<record<user>>", "'a'|'b'"
  flexible?: boolean
  readonly?: boolean
  default?: string; default_always?: boolean
  value?: string
  computed?: string
  assert?: string
  comment?: string
  reference?: ...
  permissions?: { select?: bool|string; create?; update?; delete? }   // string = WHERE expr
  table: string
}
StructTable { name; kind:{kind:"NORMAL"|"ANY"|"RELATION"; in?; out?; enforced?}; schemafull;
              drop?; comment?; changefeed?; permissions?; fields[]; indexes[]; events[] }
```

## How `normalize()` answers the 6 gotchas (where it earns its keep)

`normalize()` is the single Struct→Struct pass both sides run through. Per-concern:

1. **`option<T>` vs literal-`null` union member vs FLEXIBLE — kept DISTINCT.**
   - `option<T>` ≡ `T | none` (value may be MISSING): `normalize` folds a top-level `none` member
     into `option<…>` (today's `canonicalKind`). One canonical spelling.
   - `T | null` (value may be explicit NULL) is a DIFFERENT type — kept as a `| null` union member,
     not collapsed into `option`.
   - `FLEXIBLE` is an orthogonal boolean on the field (object accepts extra keys), never encoded in
     `kind`.
   So a field is `(kind, flexible)`; the three are independent and both lowerings must agree.

2. **literal union `"a"|"b"` vs enum vs single-literal — all just `kind` strings.** The IR does not
   distinguish enum from union; `enum(['a','b'])` and `z.union([literal('a'),literal('b')])` both
   lower to the kind `'a'|'b'`. `normalize` sorts the union members. A single literal is `'a'`.
   (enum-vs-union is a *rendering* choice in the TS renderer, not an IR fact — so the two lowerings
   converge regardless of how the schema was authored.)

3. **`record<a|b>` multi-target ordering — SORTED.** `normalize` sorts union members **inside**
   `record<…>` too, not only top-level (today's `canonicalKind` only sorts the top level — this is
   an extension). `record<b|a>` → `record<a|b>`.

4. **`array<T>` vs `array<T,N>` vs `set<T,N>` — size lowering.** Element type folds into the parent
   (`array` + `array.* TYPE object` → `array<object>`, today's `foldArrayElement`). **Open question
   for review:** does `INFO STRUCTURE` report the max-size `N` in `kind` (`array<T, N>`)? If
   `fromTableDef` emits the size (from `.max()`) but `fromInfo` doesn't, that's an asymmetry —
   `normalize` would have to STRIP the size on both sides (lose it from the compare) or we accept it
   only round-trips when INFO carries it. Need to confirm what 3.x INFO returns.

5. **permission default — stripped symmetrically.** `normalize` reduces `permissions` to a canonical
   form: when every op is the kind default (FULL for fields, NONE for tables), set
   `permissions = undefined`; otherwise keep only the non-default ops (today's `canonicalPerms`
   logic, applied to the struct). Both sides strip identically, so an unspecified `PERMISSIONS`
   deep-compares equal to a materialized default.

6. **nested-object dotted fields + parent-before-child.** `fromTableDef` flattens nested objects to
   dotted `StructField`s exactly as the emitter does (`address`, `address.city`, `tags.*`), matching
   `fromInfo`. `normalize` sorts fields with a parent-before-child comparator (and folds the trivial
   `x.*` array element into the parent type, today's `isTrivialElement`). Implicit `id` (and
   relation `in`/`out`) are dropped on both sides.

Plus: deterministic clause/field ordering, and an **edge-aware topological order across definable
TYPES** for emission (analyzer before its search index, function before the event that calls it,
table before its fields) — ordering for *render/emit*, not for equality (equality sorts).

## Lowering specifics — `fromTableDef()` (the new code)

Reads the `TableDef`/`SField` directly (NO DDL round-trip). Reuses the existing
`inferField(schema)` (`src/ddl.ts`) to compute each field's `kind` string and to flatten nested
objects/array elements into dotted paths — the SAME function the emitter uses, so the type strings
are identical by construction. Pulls clauses straight off `SField.surreal`
(`default`/`defaultAlways`/`value`/`computed`/`asserts`→joined `assert`/`readonly`/`comment`/
`permissions`/`flexible`/`reference`) and table config off `TableConfig`
(`schemafull`/`type`/`relation`→`kind.in/out`/`comment`/`permissions`/`indexes`/`events`/
`changefeed`). Standalone `FunctionDef`/`AccessDef`/`EventDef` → `StructFunction`/`StructAccess`/
`StructEvent`.

The win: `inferField` is shared, so `fromTableDef` and the emitter can't disagree on type strings;
and `fromInfo` already produces the same `kind` expressions that `inferField`/the emitter produce
(the live-parity suite proves this today). `normalize` closes the remaining ordering/default gaps.

## Sequencing

1. `fromTableDef()` + `normalize()` in isolation.
2. **Parity test (the proof):** for the corpus, assert
   `normalize(fromTableDef(schema))` deep-equals `normalize(fromInfo(schema applied to a shadow DB))`,
   per object. This is the unifier working end to end.
3. Only then: migrate the snapshot to store normalized Struct (hybrid — Struct for modeled kinds,
   raw-DDL passthrough for unmodeled, so no coverage regression), switch offline diff to structural,
   wire `diff --ts`, re-baseline examples.

`schemic diff --live` stays INFO-vs-INFO via shadow-apply (it never trusts the converter to match the
DB). The Struct-IR governs the OFFLINE world; it just makes that world renderable + structurally
diffable.

## Open questions for `@database-expert`

- (4) Does 3.x `INFO ... STRUCTURE` carry `array`/`set` max-size in the `kind`? Drives whether size
  participates in equality or must be stripped.
- Is `record<a|b>` target order from INFO ever meaningful, or always safe to sort? (Assuming sort.)
- Field-level `reference` (`REFERENCE ... ON DELETE ...`) representation — `fromInfo` currently
  leaves `reference?: unknown`; what does STRUCTURE return so both sides encode it identically?
- Anything in the implicit-default set beyond `id` / relation `in`,`out` that INFO materializes and
  the generator omits (so `normalize` must drop on both sides)?
