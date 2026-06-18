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
- **Each entry**: an authoring snippet (`s.*` / `define*`) + its exact expected
  DDL string.
- **Assertion**: a test asserts `emit(defs) === expectedDDL` — pure, deterministic,
  **no live DB connection**.
- **Drift-proof**: changing `emit` without updating the golden **fails the suite**.

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

## Reference implementations

- **SurrealDB** — `packages/surrealdb/examples/reference/*.ts` (landing on
  `feat/surrealdb-examples`).
- **Postgres** — to mirror: authoring → expected DDL goldens, pure-emit, grouped
  by feature area.
