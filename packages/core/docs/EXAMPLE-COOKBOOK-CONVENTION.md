# Convention: the verified example cookbook (`examples/reference/*.ts`)

> A standing **per-driver convention**, greenlit by Manuel (2026-06-18). A
> docs + test artifact each driver owns; not core code. Complements each
> driver's `docs/COVERAGE.md` (coverage = what's implemented; cookbook =
> verified how-it-emits).

## Convention

Every driver **MUST** keep a **verified example cookbook** under
`examples/reference/*.ts`, grouped by feature area. Each entry pairs `s.*` /
`define*` authoring with its **exact emitted DDL** as a golden, asserted by a
**pure-emit** test:

```
emit(defs) === expectedDDL
```

### MUST

- **Location**: `examples/reference/*.ts`, grouped by feature area (a file or
  section per area — tables, fields, indexes, …).
- **Each entry** (`Example`) carries:
  - `title` — the feature / syntax it demonstrates.
  - `note?` — optional caveat (round-trip note, a known gap).
  - `defs` — the authored schema objects, in emit order.
  - `code` — the **authoring source as a string** (the `s.*` / `define*` snippet,
    verbatim) — so consumers (docs, the website examples gallery) can render the
    TypeScript side, not just the DDL.
  - `ddl` — the **exact** `emit(defs)` output (the golden).
- **Assertion**: a test asserts `emit(defs) === ddl` — pure, deterministic,
  **no live DB connection**.
- **Drift-proof**: changing `emit` without updating the golden **fails the suite**.

### SHOULD — keep `code` honest

`code` is shown to users as "the authoring that produces this DDL", so it
**SHOULD** be verified against `defs` rather than maintained as free text. Prefer
deriving `defs` **from** `code` (evaluate the snippet with the driver's `s` /
`define*` in scope, then assert `emit(evaluated) === ddl`) so the three can never
disagree. If that's impractical, at minimum assert `code` is non-empty and
references the same identifiers as `defs`, and note the weaker guarantee.

### Scope / boundaries

- **Pure emit only.** Live round-trip (push / pull / introspect / diff parity)
  stays in the parity + e2e suites — the cookbook does not connect to a database.
- It is the **drift-proof source of truth** for landing/docs examples: prose and
  marketing copy quote the goldens rather than hand-written DDL.

## Why

- **Quick-reference docs** — copy-paste authoring, see exactly the DDL it produces.
- **Regression net** — when revisiting syntax or evolving a driver / core, the
  goldens catch any unintended emit change.
- **Anti-drift** — examples can't silently rot: emit and example move together or
  the suite goes red.

## Generated catalog manifest

The cookbooks feed a **single generated JSON manifest** — the drift-proof source
for the website's examples gallery and any other external consumer. A neutral
repo script reads every driver's `allGroups`, verifies `emit(defs) === ddl`, and
emits one flat catalog:

```jsonc
// examples-manifest.json — generated; do not hand-edit
{
  "source": { "commit": "<git sha>", "hash": "<content hash of entries>" },
  "entries": [
    {
      "driver": "surrealdb",        // driver slug
      "group": "tables",            // feature area (derived from the group file)
      "title": "SCHEMAFULL table",
      "note": "…",                  // optional
      "code": "defineTable(\"user\", { … })",  // authoring source
      "ddl": "DEFINE TABLE user SCHEMAFULL …", // the golden
      "lang": "surrealql"           // DDL language for syntax highlight (surrealql | sql)
    }
  ]
}
```

- **Generated, never hand-edited.** Built by `scripts/gen-examples-manifest.ts`
  (`bun run gen:examples`), which re-asserts `emit(defs) === ddl` for every entry
  as it writes — the same honesty check the cookbooks carry. **Regenerate and
  commit `examples-manifest.json` whenever a cookbook changes** (no CI guard yet).
- **`source` header** stamps the generating commit + a content hash, so a
  consumer that **vendors** a copy (e.g. the `schemichq/web` repo commits it under
  `packages/landing/`) can spot staleness at a glance and re-sync deliberately.
- **Delivery**: committed in this repo today; consumers pin it by git commit.
  When `@schemic/*` start publishing, the same shape promotes to a published
  `@schemic/examples` package — consumers' code is unchanged.

## Reference implementations

- **SurrealDB** — `packages/surrealdb/examples/*.ts` (`allGroups`), on `main`.
- **Postgres** — `packages/postgres/examples/reference/*.ts` (`allGroups`), on `main`.
