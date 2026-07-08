# Proposal: faithful single/array model + writes + upsert + relate

Status: **RATIFIED** (Manuel). Branch: `feat/surrealdb-graph-traversal`. Grounded in live 3.1.4 probes.

## The model — array by default, `ONLY` unwraps to single (SurrealDB-faithful)

Every statement returns an **array** by default. `.only()` adds the `ONLY` keyword (strict — the DB
errors unless exactly one). `.one()` (select only) = `ONLY … LIMIT 1` (lenient: first, `NONE` if empty).
`.raw()`/`.one()`/`.only()` are **output-mode flags** that compose in any order — never dead-ends.

## Status — COMPLETE

- ✅ **Reads** (`b5cbd65`): `select`/`.one()`/`.only()`/`select(T, id)` emit real `ONLY`; `SelectOne`
  deleted; `Single` type param on `Select`; `get` kept as sugar for `select(T,id).one()`.
- ✅ **Writes flip to array-default** (`3e6d564`) — DECISION **A** (uniform): `create`/`update`/`remove`
  return arrays; `.only()` emits `ONLY` + re-types to single; `RETURN NONE` -> `undefined[]`.
- ✅ **Bulk** (`215422f`): `update(T).set().where()` / `remove(T).where()` — whole-table / filtered;
  by-id target also accepts `.where` as a conditional guard.
- ✅ **`upsert`** (`c080510`): shares the update builder via a `verb` param; `upsert(T)` mints new,
  `upsert(T, id)` create-or-update, `upsert(T).set().where()` filtered bulk.
- ✅ **`relate(from, Edge, to)`** (`92ce3dd`): endpoint type-checking (record / fan-out array /
  subquery), `.set`/`.content`/`.id`/`.return`/`.timeout`/`.only`, `in`/`out` from the path.

Deferred (follow-ups, not blocking): a typed `select(...)`-builder endpoint for `relate` (subquery is
currently the `surql` raw form); optional accidental-bulk guard (see the DX note in the handoff).

**Do NOT touch the dogfood app** — Manuel updates it himself during testing. Scope = `write.ts`,
`client.ts`, in-repo `test/`, and `test/e2e`.

## Writes — array-default + `.only()` + BULK (decision A)

Flip `create`/`update`/`remove` from forced-single (`[0]` hack) to **array by default**; `.only()`
(and `.one()` where a LIMIT is meaningful) emit `ONLY` for single. Same `Single` type-param mechanism
as `Select` (a `Single extends boolean` param; `run(): Promise<Out<Res, Single>>`).

**Add bulk** (don't drop multi-write — faithful to the DB):
- `update(T).set(…) [.where(…)]` → `UPDATE t SET … [WHERE …]` (whole table / filtered) — array.
- `remove(T) [.where(…)]` → `DELETE t [WHERE …]` — array.
- `update(T, id)` / `remove(T, id)` stay the by-id single-target forms (array-default; `.only()`).
- `create` stays single-content (one row); array-default result; `.only()` → `CREATE ONLY`.

Verified grammar: `UPDATE t SET x=1`, `UPDATE t SET x=1 WHERE …`, `DELETE t`, `DELETE t WHERE …`,
`… RETURN AFTER`, `CREATE/UPDATE/DELETE ONLY …`.

`.only()` emission: the `ONLY` keyword sits after the verb — `CREATE ONLY t`, `UPDATE ONLY $__thing`,
`DELETE ONLY $__thing`, `UPSERT ONLY $__thing`, `RELATE ONLY a->e->b`.

## upsert

`upsert(T, id).set(…)/.content(…)/.merge(…)` → `UPSERT t:id …` (create-or-update). `upsert(T)` (no id)
mints a new record like create. Array-default; `.only()` for single. Same builder shape as `update`.

## relate — `relate(from, Edge, to)`

`RELATE [ONLY] <from> -> <edge>[:id] -> <to> [SET…|CONTENT…] [RETURN…] [TIMEOUT…]`. Endpoints:
record / array (fan-out) / subquery — NOT a bare table. Type-checked against the edge's `.from`/`.to`
(the enriched `RelationDef` FromRef/ToRef). Clauses: `.set(e => …)` (edge refs incl `in`/`out`) /
`.content(…)`, `.id("custom")` (pinnable edge id — unlike reads), `.return(callback|"none"|"before"|
"after"|"diff")`, `.timeout("5s")`. Array-default; single endpoints + `.only()` → `RELATE ONLY`.
No `PARALLEL` (invalid on RELATE); no upsert-relate (RELATE always creates).
