# Schemic — roadmap

The **query-layer arc** + the foundations it rests on. Design source: `query-layer-spec.md` (§6, the
Phase 0–6 arc) + `query-layer-phase0-plan.md` (the M0–M5 milestones), on the `explore/query-layer`
branch. Packages release **in lockstep**; see `CHANGELOG.md` for what's shipped vs accumulating.

Legend: ✅ done · 🚧 in progress · 🟡 partial · ⏳ not started

---

## Phase 0 — typed reads + foundations ✅ *(complete; shipped alpha.18–.21)*

**Core (M0)**
- ✅ **M0.1** `@schemic/core/query` toolkit — `Row`/`FieldRef` (`brandRef`), `Project<P>` projection
  inference, `projectionSchema`/`decodeProjection`.
- ✅ **M0.2** `callable` capability on the `Driver` contract + `callFunction` (invoke + decode).
- ✅ **M0.3** package-split: side-effect-free authoring index + `/driver` + `/connection` subpaths; the
  CLI loader now **requires** `/driver` (index fallback removed). **Closed.**

**Drivers (M1–M5)**
- ✅ Typed single-table `select().where().orderBy().limit().return()` → SQL → decode-by-default,
  `.raw()`. Live on both `@schemic/postgres/query` + `@schemic/surrealdb/query`.

## Phase 1 — DB functions as code (`.call`) 🚧

- ✅ core `callFunction` — invoke via `callable` + decode through `.returns(R)`.
- 🚧 driver `invoke` + `defineFunction(args).returns(R).call(db, args)` — **surrealdb ✅**; **postgres
  ⏸ on hold** (Manuel).
- ⏳ raw-body ↔ `.returns()` **soundness shadow-check** (design: `query-layer-soundness.md`) — gated on
  the drivers exposing `callable` + a `shadowInvoke`.

## Phase 2 — writes ⏳
`CREATE` / `UPDATE` / `DELETE` / `UPSERT` + `RETURN`. Mostly driver-owned (reuse `TableDef.encode`).

## Phase 3 — multi-table ⏳
surrealdb graph (`->`/`<-`) + `FETCH`; postgres joins / CTE. Driver-native (`native` constructs).

## Phase 4 — function library + operators ⏳
The `fn.*` namespaces to parity + full operator coverage.

## Phase 5 — live queries ⏳
`LIVE SELECT` (+ `DIFF`), typed subscriptions, `KILL`.

## Phase 6 — `DEFINE`/admin via the builder 🟡
Partial — the schema engine already emits/migrates `DEFINE *`; exposing it through the builder is the
remaining piece.

## Deferred / future
- The `"use database"` **directive compiler** (lift plain functions into `defineFunction`).
- Durable **workflows** (`defineWorkflow`).
- A **neutral cross-driver builder** — only if cross-driver queries ever become a real need (the neutral
  query IR was retired; see the spec's decision banner).

---

## Parallel track — driver schema coverage *(not the query layer)*
Per-driver DDL completeness, tracked in each driver's `docs/COVERAGE.md`.
- ✅ **postgres:** standalone DDL objects (sequence/domain/extension/matview), functions/triggers/RLS,
  composite + non-id FKs, rich indexes (gin/gist/brin/hash + partial).
- ✅ **surrealdb:** full `DEFINE ANALYZER` coverage + fluent `defineAnalyzer`.
- ⏳ ongoing per-dialect gaps.
