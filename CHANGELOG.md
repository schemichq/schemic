# Changelog

All notable changes to the Schemic packages (`@schemic/core`, `@schemic/cli`, `@schemic/surrealdb`,
`@schemic/postgres`, `create-schemic`, `schemic`) are recorded here. The packages release **in lockstep**
(one version across all six), so this is a single changelog.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Changes **accumulate** under
**Unreleased** and are stamped into a version section when Manuel confirms a release cut. Entries are
tagged by package (**core** / **cli** / **surrealdb** / **postgres** / **setup**). Versions before
`alpha.18` predate this changelog — see git history.

## [Unreleased]

### Added
- **surrealdb:** DEFINE ACCESS (Phase 1, non-secret) — `.comment()` + `.withRefresh()` with a full
  round-trip (emit / introspect / canonical / lower / pull) and a RECORD-is-database-only guard (throws
  on `ON NAMESPACE`/`ON ROOT` + RECORD). Secret-key forms (`WITH JWT`/`ISSUER`) deferred to Phase 2.
- **surrealdb:** DEFINE FIELD + INDEX + EVENT + FUNCTION + ACCESS syntax-coverage groups — pin every authorable
  clause author -> emit (FIELD: TYPE, OVERWRITE / IF NOT EXISTS, FLEXIBLE, REFERENCE ON DELETE, DEFAULT /
  DEFAULT ALWAYS, READONLY, VALUE, ASSERT, COMPUTED, PERMISSIONS, COMMENT; INDEX: FIELDS, composite,
  UNIQUE, FULLTEXT analyzer + BM25 + HIGHLIGHTS, HNSW, DISKANN, COUNT, COMMENT; EVENT: WHEN + THEN,
  OVERWRITE, IF NOT EXISTS, WHEN-omitted, ordered THEN; FUNCTION: args, return type, no-args,
  OVERWRITE / IF NOT EXISTS, PERMISSIONS FULL/NONE/WHERE, COMMENT). Plus `docs/SYNTAX-COVERAGE.md`, the
  engine-validated grammar + coverage tracker.
- **surrealdb:** DEFINE EVENT `async` + `comment` authoring — `.event()` / `defineEvent` now take
  `async?: boolean | { retry?, maxDepth? }` and `comment?`, emitting `ASYNC [RETRY] [MAXDEPTH]` +
  `COMMENT` in grammar order, with a full round-trip (emit strips the materialized `RETRY 1` /
  `MAXDEPTH 3` defaults; introspect + `pull` regenerate clean authoring).
- **surrealdb:** `defineAnalyzer().function(cb, name?)` — optional custom name for the auto-defined
  function (mirrors `.$unique(name)` / `.$index(name)`); the collision check still applies.
- **surrealdb:** author-time DEFINE FIELD validation — `emit()` now rejects the combos the SurrealDB
  parser rejects, with a clear gen-time error instead of a cryptic apply failure (`$computed` is
  mutually exclusive with `$value`/`$default`/`$readonly`/`$reference`/`$assert` and top-level only;
  `$reference` requires a record-link type and top-level; `FLEXIBLE` is schemafull-only). Invalid combos
  that previously emitted bad DDL now throw (they failed at apply anyway).

### Changed (BREAKING — alpha)
- **surrealdb:** renamed `.reference()` -> `.$reference()` on field builders — field DDL clauses are
  `$`-prefixed (consistent with `.$unique()` / `.$index()` / `.$default()`). Update callers + the pull
  renderer migrated.

### Changed
- **cli:** the driver loader now **requires** the `@schemic/<driver>/driver` entry (dropped the index
  fallback) — completes the M0.3 package split. Drivers must be >= 0.1.0-alpha.21.

### Fixed
- **surrealdb:** `defineAnalyzer().function()` now emits its auto-defined `DEFINE FUNCTION` — `gen`
  previously produced an analyzer referencing a non-existent `<analyzer>_fn`. The inlined function is
  emitted before the analyzer and deduped; a name collision with a differently-bodied function throws
  (no silent clobber).
- **cli:** `schemic gen` now shows the rendered migration **before** the title prompt (you review the
  actual DDL while naming it), instead of after writing.

## [0.1.0-alpha.21] - 2026-06-23

### Added
- **surrealdb:** `defineFunction(args).returns(R).call(db, args)` — the (B) DB-functions-as-code call
  site over core's `callFunction`: args encoded via the param schemas, result decoded through `.returns(R)`
  (so `.returns(s.datetime()).call(db)` yields a real `Date`). First driver impl of the `callable` capability.

### Changed (BREAKING — alpha)
- **postgres / surrealdb (package split, M0.3):** the authoring index (`@schemic/<driver>`) is now
  **side-effect-free** — `s.*`/`define*`/`surql` only. Moved out:
  - the **connection factory** + connection types → `@schemic/<driver>/connection`
    (`surrealConnection`, `postgresConnection`/`PgConn`/`pgSql`). Update `schemic.config.ts` imports.
  - the **`Driver` impl** + `emit*`/`lower`/`introspect` + the `registerDriver` side-effect →
    `@schemic/<driver>/driver` (engine/CLI-only).
  So importing `s.*` no longer drags the diff/emit engine or registers the driver. The query builder
  stays at `@schemic/<driver>/query`. (surrealdb also made its field registries `globalThis` singletons
  so the index and `/driver` module instances share state.)

### Changed
- **cli:** the driver loader resolves a driver via its `@schemic/<driver>/driver` subpath first (falling
  back to the package index for not-yet-split drivers).

## [0.1.0-alpha.20] - 2026-06-23

### Added
- **core:** `callFunction` in `@schemic/core/query` — invoke a defined DB function via the `callable`
  capability and decode the result through `.returns(R)` (the neutral half of the query layer's (B)
  `.call()`). `CallableFunctions.invoke` now returns the raw function result for `R` to decode (no
  driver implemented `callable` yet, so no break).
- **cli:** `schemic pull --watch` — poll the live DB (`--interval`, default 2s) and re-pull as it
  changes (preview, or apply with `--write`); a DB-poll loop, not fsWatch (which would self-trigger on
  pull's own file writes).

### Changed
- **surrealdb:** `pull` renders analyzer filters via the typed `.filters(f => [...])` builder callback
  instead of string literals (round-trips identically).

### Fixed
- **surrealdb:** `defineAnalyzer().filters()` no longer dedupes — duplicate filters pass through verbatim
  (follow-up to the alpha.19 tokenizers fix; drops the now-unused `uniqueClause` helper).

## [0.1.0-alpha.19] - 2026-06-23

### Fixed
- **surrealdb:** `defineAnalyzer().tokenizers()` no longer dedupes — duplicate tokenizers pass through
  verbatim (`TOKENIZERS blank, blank`).

## [0.1.0-alpha.18] - 2026-06-23

### Added
- **core:** `@schemic/core/query` — the neutral query toolkit driver builders compose: `FieldRefBase`
  (+ `brandRef`), `Project<P>` projection inference, `projectionSchema`/`decodeProjection`. Plus the
  `callable` capability on the `Driver` contract.
- **postgres / surrealdb:** typed single-table `select()` query builder at `@schemic/<driver>/query`
  (`where`/`orderBy`/`limit`/`.return` projection; decode-by-default; `.raw()` opts out) — the
  driver-owned builder composing the core toolkit.
- **postgres:** standalone DDL objects — `defineSequence` / `defineDomain` / `defineExtension` /
  `defineMaterializedView`.
- **postgres:** functions, triggers, and RLS policies — `defineFunction` / `defineTrigger` /
  `definePolicy` (auto-enables RLS).
- **postgres:** composite + non-id foreign keys (`defineTable().foreignKey({ columns, refTable,
  refColumns })`); richer indexes — access methods (gin/gist/brin/hash) + partial (`where`).
- **surrealdb:** full `DEFINE ANALYZER` coverage + a fluent `defineAnalyzer` builder (tokenizers,
  filters, function, comment).

### Changed (BREAKING — alpha, no stable consumers)
- **surrealdb:** `.flexible()` / `.loose()` / `.strict()` are now **object-only** — a compile error on
  non-object fields (was a silent no-op). `defineAnalyzer`'s config-object form is dropped in favor of
  the fluent builder.
