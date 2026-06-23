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
