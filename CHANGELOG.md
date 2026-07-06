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
- **cli / core:** debuggable errors — `SCHEMIC_DEBUG=1` (or `--stack`) prints the full stack + the
  `.cause` chain on any CLI failure (default output unchanged, now with a hint line), and a crashing
  schema module always reports the FAILING FILE path (original error as `cause`).
- **core:** typed cross-connection resolution — (A) a resolver's `ctx.connections.<name>` handle is
  now THENABLE to that sibling's FULL ORM client (`const main = await ctx.connections.main;
  main.select(...)`) while keeping direct `.query`; (B) the CHAINED config builder —
  `defineConfig().connection(name, driverFactory, staticConfig | (ctx, args) => config | config[])` —
  where the driver FACTORY itself is the marker and each resolver's `ctx.connections` is contextually
  typed with the ACCUMULATED prior connections (order = visibility = structural cycle prevention).
  The literal `defineConfig({ connections })` form is unchanged.
- **core / surrealdb / postgres:** table COMPOSITION + derived schemas (cross-driver convention, from
  real usage): `defineTable(name, s.object())`, a public native `s.object().fields` map (inverse of
  `.shape`), `TableDef.extend(shape | s.object())` typed cast-free column mixins, and derived
  Standard-Schema input schemas — `TableDef.create` (defaults/id optional, internal dropped) and
  `TableDef.update` (partial, id/readonly excluded) — composable via `.partial/.extend/.refine/.or`.
- **core:** ORM client P1 foundation — `OrmClientBase` (disposable bound-client contract: `close` +
  `[Symbol.asyncDispose]`, so `await using db = await connect()` auto-closes), the `asyncDisposable`
  mixin, and `resolveConnection(name?)` (managed path over the project config).
- **surrealdb / postgres:** the bound ORM client (P1 reads) at `@schemic/<driver>/client` —
  `connect(name?)` MANAGED from the config / `connect(client)` BYO (close = no-op), `db.select(table)`
  pre-bound + awaitable (thenable builder; standalone `.run(db)` still works), AsyncDisposable;
  surreal adds a disposable `forkSession()`.
- **core:** config-as-factory with PARAMETERIZED connections — `defineConfig` is generic and returns
  the config with a **typed `connect(name, args?)`**: connection names autocomplete (a typo is a
  compile error), `args` is the resolver's own declared 2nd param (`(ctx, args) => config | config[]`,
  typed per connection; absent for static connections), and each entry's own client type is inferred
  (heterogeneous-driver projects type per-connection). An ARRAY resolution is bulk-only (migrations
  enumerate it) — `connect` throws a teaching error; pass args selecting one. `key` is a display label
  (not an address); entries may add a dialect `label` hook for bulk reporting. Resolvers can query
  sibling connections via `ctx.connections` at runtime (lazy open through the entries' embedded client
  openers, cycle-detected, auto-closed). CLI: `--args <json>` + `--arg k=v` sugar feed resolver args.
- **core:** the config loader accepts a NAMED `schemic` export as well as a default — scaffolded form
  becomes `export const schemic = defineConfig(...)` in `schemic.config.ts` (deterministic
  `import { schemic }` -> `schemic.connect()` auto-import, no file rename); a bare `schemic.ts` is
  also discovered (shape-guarded).
- **surrealdb / postgres:** ORM P2 WRITES on the bound client — split builders
  (`db.create(T).content(data)`, `db.update(T, id).merge(...)` / `.content(...)` / `.set(...)`,
  `db.delete(T, id)` — pg exports `remove`), decoding through the codec channel fail-fast and
  returning typed rows that CARRY their id.
- **surrealdb / postgres:** query Phase 1 READS — richer WHERE operators under the shared cross-driver
  op contract, pagination, and `one()` / `get()` / `count()` terminals on the select builder.
- **surrealdb / postgres:** table PRESETS — `defineTable.preset(...)` reusable table fragments applied
  via the chained single-arg `TableDef.use(a).use(b)` (ratified cross-driver form; columns + indexes).
- **surrealdb:** TYPED FRAGMENTS (phases 0–3) — the query builder and raw `surql` compose BOTH ways:
  eager marker resolution in the tag (`TableDef`/`FunctionDef`/`surql.$` paths splice as text, output
  is always a plain `BoundQuery`); builders interpolate as subquery fragments with namespaced binds;
  raw predicates drop into `.where(...)`; `` surql`…`.as<T>() `` retypes a fragment (the `[T]` rule);
  contextual TYPED callbacks on authoring slots (events `(e) =>` with `e.after`/`e.before` typed to
  the table shape, field clauses `(f) =>`, permissions `(p) =>` with `p.row`/`p.auth`, function bodies
  with args typed by name); typed `Operand<T>` — `$param` refs and fragments are legal builder
  operands (type mismatch = compile error); the `surql.fn` builtin catalog (live-verified vs 3.1.4) +
  kind-mapped ref stdlib (`u.name.length().gt(3)`); `block()` typed statement builder with OBJECT
  bindings (`.let({ n: v })`, `.for({ item: iter }, body)` — the var name is a real property, so
  rename/find-refs work); `$parent` correlated subqueries; `Def.call(args)` typed named-arg function
  calls that also accept refs + builders; `ParamRef.as<T>()` types an untyped `surql.$` param chain
  for typed operand/call/fn positions (type-only cast). FULL-TS function bodies (zero raw surql):
  `surql.fn` returns retypeable `Surql` (`.as<T>` everywhere) with `http.*<R>` response generics,
  plain object/array args SPLICE embedded refs (`{ to: [$email] }`) while pure data binds whole, ref
  PROPERTY PATHS (`sv.res.id` -> `$res.id`, `$parent`-aware), and `block().return` takes predicate
  Exprs. Plus lazy record refs `s.recordId(() => User)` (kills mutual-link import cycles) and
  auto-blocking of multi-statement event bodies.
- **surrealdb:** the authoring index re-exports the SDK VALUE surface (`Surreal`, `RecordId`, `Table`,
  `DateTime`, `Duration`, geometry types, …) so apps never import `surrealdb` directly —
  single-instance by construction (the SDK's `#private` classes are nominal; dual copies break
  `instanceof` and assignability).
- **surrealdb:** `defineSingleton(name, shape, { id? })` — one-record tables: emits the LITERAL id
  type (`DEFINE FIELD id … TYPE 'default'`, DB-enforced), id-optional client sugar (`db.get(Config)`;
  create/update/delete target THE record), and the literal id survives lower/normalize so it emits,
  diffs, and `pull` regenerates `defineSingleton`.
- **surrealdb:** `DEFINE PARAM` with the access-style secret split — an INLINE LITERAL value is fully
  managed (emit/diff/migrations/pull round-trip); an `env()`/`secret()` value is SECRET and excluded
  from snapshots/migrations (SurrealDB stores param values readably), deployed out-of-band via new
  `sc param push/check/list` (placeholder + binding — the value never appears in DDL text, and `pull`
  drops out-of-band params so values never reach generated source); a bare schema declares presence
  only. Typed `Def.$` deep param ref; the def splices `$name` in templates — and a `ParamDef` in ANY
  value position (operands, block values, fn/call args, spliced object values) splices `$name` typed
  by its `T` (other def kinds in value positions throw guidance instead of serializing to
  `[object Object]`). Expression values are rejected by design (the DB stores them EVALUATED — they
  can't round-trip).
- **surrealdb:** `formatSurql` — pretty-prints generated SurrealQL (INFO collapses bodies to one
  line; `pull` now writes statement-per-line with indented nested blocks and wrapped wide objects;
  idempotent, strings untouched). Wired into pull's function/event/access renders and exported from
  `/driver` for external display panes. Drift-safe by construction (normalize canonicalizes
  formatting — which now also strips trailing commas; hand-authored ones phantom-diffed before).
  Every display/output boundary pretty-prints (`sc diff`, gen, live diff, migration files with
  line-aware indent) while every COMPARISON stays canonical single-line — snapshots unchanged, no
  phantom churn on upgrade.

### Fixed
- **core:** the DEFAULT migrations dir now follows the documented contract — RELATIVE TO THE SCHEMA
  (its sibling `migrations` dir) instead of a root-fixed `./database/migrations`. A nested schema
  (`schema: "./src/database/schema"`) previously split state: `init` scaffolded the snapshot
  schema-relative while `gen` wrote migrations + a second snapshot at the root default. Standard
  scaffold layouts are unchanged; an explicit `migrations` override still resolves from the root.
- **surrealdb:** `inline()` bind rewriting is boundary-aware — `$b1` no longer corrupts `$b10` with
  10+ binds (latent).
- **surrealdb:** `normalize` canonicalizes FORMATTING of function blocks / event exprs / field
  clauses / permissions (quote-aware whitespace collapse + INFO-style punctuation spacing + strip
  `;`-before-`}`) — any multi-line-authored surql body previously phantom-diffed forever against
  INFO's single-line printing; also folds `s"..."` -> `'...'` on function blocks/events (inlined
  strings phantom-diffed).
- **surrealdb:** an empty `block()` no longer emits invalid `{ ; }` — it renders the valid no-op
  `{ }` (live-verified).
- **postgres:** returned rows carry the implicit `id` (select + write `RETURNING`).
- **core:** multi-line DDL renders with PER-LINE diff indicators — now that drivers pretty-print
  display statements, every line of a statement gets its `+`/`-` in `sc diff` (a bare continuation
  line read as context), unified-patch hunk counts count LINES not statements, the rollback block
  dims/indents per line, and the inline word-diff view collapses whitespace onto one line.

### Changed (BREAKING — alpha)
- **surrealdb:** dropped the deprecated `$`-less field aliases `.unique()`/`.index()` — use
  `.$unique()`/`.$index()` (aligns with postgres, already `$`-only; table-level composite
  `.index(name, fields)` unchanged).
- **surrealdb:** `db.query` is SDK-FAITHFUL — awaiting resolves the PER-STATEMENT result array (the
  old first-statement unwrap silently dropped every result after statement #1); `surql<[T1, T2]>`
  typing flows end-to-end, plain strings take `db.query<[User[]]>(...)`. Correspondingly `.as(...)`
  takes a decoder TUPLE mirroring the statements — `.as([z.number(), User.object.array()])` resolves
  `[number, App[]]` positionally; decoders are plain schemas (`TableDef.object` is the bridge into
  Zod land — no bespoke rows decoder), and a decoder-count mismatch is a teaching error.
- **surrealdb:** the `surrealdb` SDK moved from a regular dependency to a PEER dependency
  (app-vs-driver version drift created dual SDK copies whose nominal `#private` classes are
  incompatible), and `` surql`…`.as<T>() `` replaces the separate `surql.expr` tag (a second tag name
  broke editor syntax highlighting).

## [0.1.0-alpha.24] - 2026-07-01

### Added
- **core:** `KindEngine.excludeFromMigrations` — a kind can opt OUT of the migration pipeline entirely.
  Objects of an excluded kind are skipped by snapshot, diff, gen, and the introspect-compare, so they
  never enter a migration file nor phantom-diff; the kind is managed out-of-band by the driver's own
  `sc <kind> …` commands. For secret-bearing kinds whose lifecycle doesn't fit committed migrations
  (SurrealDB `DEFINE ACCESS`: the DB redacts keys on introspection, and keys rotate independently).
- **core:** `DriverCommand` contract — drivers can contribute dialect-specific CLI commands invoked as
  `sc <kind> <verb> [args]` (e.g. surreal `access rotate <name>`, postgres `matview refresh <name>`).
  Core owns only the general mechanism: it discovers `driver.commands`, parses argv (variadic positionals
  + value/boolean flags), resolves the connection, and dispatches to `run` with a `CommandContext`
  ({conn, config, io with prompt(), secrets}); the driver owns each kind/verb's meaning.
- **cli:** the dispatch for `DriverCommand`s — the `schemic`/`sc` bin discovers the active driver's
  `commands` (from the project config) and registers each as `sc <kind> <verb> [args]`, grouped by kind,
  with `--help`. It parses the invocation (variadic positionals + value/boolean flags), opens the
  connection, and runs the command with its `CommandContext`. No project / no driver commands -> no-op
  (built-in commands unaffected).
- **core:** secret-bearing DDL foundations (Phase-2a of the DEFINE ACCESS secret contract) — `SecretRef`
  + `env()`/`secret()` author-time helpers + a pluggable `SecretProvider` (default reads `process.env`),
  and a write-only `bindings` carrier (`$param` -> `SecretRef`) on `Statement` + `Diff`. The secret
  value never lives in the schema, snapshot, or migration: it is resolved at apply through the provider
  and passed as a bound parameter. Drivers re-export `env`/`secret`; apply-time resolution + migration
  persistence land next.
- **core:** `s.*` fields now expose the [Standard Schema](https://standardschema.dev) `~standard`
  interface (forwarded from the wrapped Zod schema on `SFieldBase`), so a Schemic field drops straight
  into any Standard Schema consumer (tRPC, TanStack Form/Router, …) without unwrapping to `.schema`.
  `validate` runs the decode direction (wire -> app). Postgres inherits it via core's `SFieldBase`;
  surrealdb mirrors it on its own base (it does not yet share core's `SFieldBase`).
- **core:** `SFieldBase` (the `s.*` base) gains the remaining Zod 4 shared-base methods for closer
  drop-in parity — `nonoptional`, `exactOptional`, `isOptional`, `isNullable`, `toJSONSchema`, a
  `description` getter, `register`, and `spa`. `@schemic/postgres` inherits them immediately (it
  composes core's `SFieldBase`); `@schemic/surrealdb` mirrors them on its own base.

### Changed (BREAKING — alpha)
- **postgres:** `connect()` now **fails loud** on a `postgres://` (any non-`file:` URL scheme)
  connection url — it throws instead of silently spinning up an in-memory throwaway (a silent
  data-loss footgun where a user pointing at a real server "succeeded" against a disposable DB).
  `connect` is now async. `file:<dir>` (persistent) and `""`/omitted (in-memory) are unchanged;
  hosted `postgres://` is reserved for a future node-postgres client.

### Fixed
- **cli:** bare `schemic` / `sc` (no args) now lists the active driver's contributed commands
  (`sc <kind> <verb>`) in its help, like `sc --help` already did. The no-arg help printed before driver
  commands had registered; registration now runs first.

## [0.1.0-alpha.22] - 2026-06-26

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
- **surrealdb:** `.$fulltext({ bm25 })` narrows from `boolean | [k1, b]` to `[k1, b]` only — `bm25: true`
  is dropped (it was a no-op: BM25 is always-on and the materialized default is stripped on emit, so
  `true` emitted nothing). `bm25` now means purely "tune the parameters."
- **surrealdb:** `defineAccess(name)` now **requires** an explicit scope — `.onDatabase()` /
  `.onNamespace()` — enforced at **compile time** (`defineAccess` returns an `UnscopedAccessDef` exposing
  only the two scope methods, so `defineAccess("x").bearer(...)` is a type error), with `emit()` still
  throwing as a runtime backstop. The silent `ON DATABASE` default is gone — access scope is a security
  boundary, so it must be chosen, not defaulted.
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
