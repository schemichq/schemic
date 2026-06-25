# SurrealQL Syntax Coverage — `@schemic/surrealdb`

A grammar-accurate tracker for **100% of SurrealQL's syntax**. Each statement is reproduced as a
**verbatim grammar block from the [SurrealQL reference](https://surrealdb.com/docs/surrealql)** (with
its full branching), followed by a checkbox for every clause/branch.

## How this works

- **A box is `[x]` ONLY after Manuel marks it covered** — and a box is marked covered only when there is
  a **verified item in our `coverage/` test suite** (`packages/surrealdb/coverage/<statement>/*.ts`,
  asserted by `test/coverage/*`) that pins the authored `s.*`/`define*` form to the exact DDL, and
  Manuel has approved it. Passing some other test does **not** count. So everything starts `[ ]`.
- This is **separate** from [`COVERAGE.md`](./COVERAGE.md) (the prose round-trip feature list). This doc
  is the exhaustive, clause-by-clause grammar map driving the coverage suite to completeness.
- **Grammar blocks are copied verbatim from the reference site** (whitespace normalized for markdown).
  Nothing is written from memory — a block marked _pending_ means its reference page still needs to be
  fetched. If SurrealDB's grammar changes, re-fetch.

**Legend:** `[ ]` not yet marked covered · `[x]` Manuel-confirmed covered by a `coverage/` item.
Statements Schemic does not author (DML/control-flow) are tracked here for the **query layer**'s sake.

**Validation basis:** grammar blocks are cross-checked against the **SurrealDB engine source** itself — the
parser (`core/src/syn/parser/stmt/*`) and the canonical `Display`/`ToSql` impls (`core/src/sql/statements/*`,
the exact form `INFO FOR …` serializes). Verified against tag **`v3.1.4`** (the version `@schemic/surrealdb`
round-trips against) and re-checked against `3.2.0-nightly` (`main`); clauses present in both are unmarked,
divergences are called out inline. Clauses that are **engine-confirmed but absent from the public docs site**
are included (this is a 100%-syntax map) and tagged _(engine-confirmed; undocumented on the reference site)_.

---

# DEFINE

## DEFINE TABLE

```
DEFINE TABLE [ OVERWRITE | IF NOT EXISTS ] @name
    [ DROP ]
    [ SCHEMAFULL | SCHEMALESS ]
    [ TYPE [ ANY | NORMAL | RELATION [ IN | FROM ] @table [ OUT | TO ] @table [ ENFORCED ]]]
    [ AS SELECT @projections
        FROM @tables
        [ WHERE @condition ]
        [ GROUP [ BY @groups | ALL ] ]
    ]
    [ CHANGEFEED @duration [ INCLUDE ORIGINAL ] ]
    [ PERMISSIONS [ NONE | FULL
        | FOR select @expression
        | FOR create @expression
        | FOR update @expression
        | FOR delete @expression
    ] ]
    [ COMMENT @string ]
    [ GRAPHQL_ALIAS @string ]
    [ GRAPHQL_DEPRECATED @string ]
```

- [x] `OVERWRITE` · [x] `IF NOT EXISTS` · [x] `DROP` · [x] `SCHEMAFULL` · [x] `SCHEMALESS`
- [x] `TYPE ANY` · [x] `TYPE NORMAL` · [x] `TYPE RELATION` · [x] `RELATION IN|FROM @table` · [x] `RELATION OUT|TO @table` · [x] `RELATION … ENFORCED`
- [x] `AS SELECT @projections` · [x] `… FROM @tables` · [ ] `… WHERE @condition` · [ ] `… GROUP BY @groups` · [ ] `… GROUP ALL`
- [x] `CHANGEFEED @duration` · [x] `CHANGEFEED … INCLUDE ORIGINAL`
- [x] `PERMISSIONS NONE` · [x] `PERMISSIONS FULL` · [x] `FOR select` · [x] `FOR create` · [x] `FOR update` · [x] `FOR delete`
- [x] `COMMENT @string`
- [ ] `GRAPHQL_ALIAS @string` · [ ] `GRAPHQL_DEPRECATED @string` _(engine-confirmed; undocumented on the reference site — `define/table.rs`)_

## DEFINE FIELD

```
DEFINE FIELD [ OVERWRITE | IF NOT EXISTS ] @name ON [ TABLE ] @table
	[ TYPE @type | object [ FLEXIBLE ] ]
	[ REFERENCE
		[ ON DELETE REJECT |
			ON DELETE CASCADE |
			ON DELETE IGNORE |
			ON DELETE UNSET |
			ON DELETE THEN @expression ]
	]
	[ DEFAULT [ALWAYS] @expression ]
	[ READONLY ]
	[ VALUE @expression ]
	[ ASSERT @expression ]
	[ COMPUTED @expression ]
	[ PERMISSIONS [ NONE | FULL
		| FOR select @expression
		| FOR create @expression
		| FOR update @expression
	] ]
	[ COMMENT @string ]
	[ GRAPHQL_ALIAS @string ]
	[ GRAPHQL_DEPRECATED @string ]
```

- [x] `OVERWRITE` · [x] `IF NOT EXISTS` · [x] `ON [ TABLE ] @table`
- [x] `TYPE @type` · [x] `TYPE … FLEXIBLE` — `FLEXIBLE` is a postfix flag on the type; the engine serializes it as `TYPE <kind> FLEXIBLE` (`define/field.rs`)
- [x] `REFERENCE ON DELETE REJECT` · [x] `… CASCADE` · [x] `… IGNORE` · [x] `… UNSET` · [x] `… THEN @expression` — a bare `REFERENCE` defaults to `ON DELETE IGNORE`
- [x] `DEFAULT @expression` · [x] `DEFAULT ALWAYS @expression` · [x] `READONLY` · [x] `VALUE @expression` · [x] `ASSERT @expression`
- [x] `COMPUTED @expression` (derived, read-only column — `define/field.rs`)
- [x] `PERMISSIONS NONE` · [x] `PERMISSIONS FULL` · [x] `FOR select` · [x] `FOR create` · [x] `FOR update` _(fields have no `FOR delete` — the parser rejects it: `parser/stmt/parts.rs`)_
- [x] `COMMENT @string`
- [ ] `GRAPHQL_ALIAS @string` · [ ] `GRAPHQL_DEPRECATED @string` _(engine-confirmed; undocumented on the reference site)_

## DEFINE INDEX

```
DEFINE INDEX [ OVERWRITE | IF NOT EXISTS ] @name
    ON [ TABLE ] @table
    [ FIELDS | COLUMNS ] @fields
    [ @special_clause ]
    [ COMMENT @string ]
    [ CONCURRENTLY ]
    [ DEFER ]

Special index clauses:

UNIQUE
| COUNT
| FULLTEXT ANALYZER @analyzer [ BM25 [(@k1, @b)] ] [ HIGHLIGHTS ]
| HNSW DIMENSION @dimension [ TYPE @type ] [ DIST @distance ] [ EFC @efc ] [ M @m ] [ M0 @m0 ] [ LM @lm ] [ EXTEND_CANDIDATES ] [ KEEP_PRUNED_CONNECTIONS ] [ HASHED_VECTOR ]
| DISKANN DIMENSION @dimension [ TYPE @type ] [ DIST @distance ] [ DEGREE @degree ] [ L_BUILD @l_build ] [ ALPHA @alpha ] [ HASHED_VECTOR ]
```

- [x] `OVERWRITE` · [x] `IF NOT EXISTS` · [x] `ON [ TABLE ] @table` · [x] `FIELDS @fields` · [ ] `COLUMNS @fields` (`COLUMNS` is a lexer alias for `FIELDS`)
- [x] `UNIQUE` · [x] `COUNT`
- [x] `FULLTEXT ANALYZER @analyzer` · [ ] `… BM25` · [x] `… BM25(@k1, @b)` · [x] `… HIGHLIGHTS`
- [x] `HNSW DIMENSION` · [x] `HNSW TYPE|DIST|EFC|M` · [ ] `HNSW M0|LM|EXTEND_CANDIDATES|KEEP_PRUNED_CONNECTIONS|HASHED_VECTOR` _(engine-confirmed; `M0` defaults to `2·M`, `LM` to `1/ln(M)` — `parser/stmt/define.rs`)_
- [x] `DISKANN DIMENSION` · [ ] `DISKANN TYPE|DIST|DEGREE|L_BUILD|ALPHA|HASHED_VECTOR`
- [x] `COMMENT @string` · [ ] `CONCURRENTLY`
- [ ] `DEFER` — ⚠ **not accepted by the v3.1.4 or 3.2-nightly parser** (no `DEFER` token; appears on the docs site only). Tracked but not engine-real; do not pin a coverage item until upstream adds it.

## DEFINE EVENT

```
DEFINE EVENT [ IF NOT EXISTS | OVERWRITE ] @name ON [ TABLE ] @table
  [ ASYNC [ RETRY @retry ] [ MAXDEPTH @max_depth ] ]
  [ WHEN @condition ]
  [ THEN @action ]
  [ COMMENT @string ]
```

- [x] `IF NOT EXISTS` · [x] `OVERWRITE` · [x] `ON [ TABLE ] @table`
- [x] `ASYNC` · [x] `ASYNC RETRY @retry` · [x] `ASYNC MAXDEPTH @max_depth` _(materialized defaults RETRY 1 / MAXDEPTH 3 are stripped on emit — `catalog/schema/event.rs`)_
- [x] `WHEN @condition` · [x] `THEN @action` · [x] `THEN [ … ]` (ordered actions) · [x] `COMMENT @string`

## DEFINE FUNCTION

```
DEFINE FUNCTION [ OVERWRITE | IF NOT EXISTS ] fn::@name
  ( [ @argument: @type ... ] ) [ -> @type ] {
	[ @query ... ]
	[ RETURN @returned ]
} [ COMMENT @string ] [ GRAPHQL_ALIAS @string ] [ GRAPHQL_DEPRECATED @string ] [ PERMISSIONS [ NONE | FULL | WHERE @condition]]
```

- [ ] `OVERWRITE` · [ ] `IF NOT EXISTS` · [ ] `fn::@name`
- [ ] `( @argument: @type, … )` · [ ] `-> @type` · [ ] `{ @query … }` body · [ ] `RETURN @returned`
- [ ] `COMMENT @string` · [ ] `GRAPHQL_ALIAS @string` · [ ] `GRAPHQL_DEPRECATED @string` _(engine-confirmed; undocumented on the reference site)_
- [ ] `PERMISSIONS NONE` · [ ] `PERMISSIONS FULL` · [ ] `PERMISSIONS WHERE @condition`

## DEFINE ANALYZER

```
DEFINE ANALYZER [ OVERWRITE | IF NOT EXISTS ] @name [ FUNCTION
  @function ] [ TOKENIZERS @tokenizers ] [ FILTERS @filters ] [
  COMMENT @string ]
```

- [x] `OVERWRITE` · [x] `IF NOT EXISTS` · [x] `FUNCTION @function` · [x] `TOKENIZERS @tokenizers` · [x] `FILTERS @filters` · [x] `COMMENT @string`

## DEFINE ACCESS

```
DEFINE ACCESS [ OVERWRITE | IF NOT EXISTS ] @name
  ON [ ROOT | NAMESPACE | DATABASE ]
  TYPE [
    JWT [ ALGORITHM @algorithm KEY @key | URL @url ] [ WITH ISSUER KEY @key ]
    | RECORD
      [ SIGNUP @expression ]
      [ SIGNIN @expression ]
      [ WITH JWT
        [ ALGORITHM @algorithm KEY @key | URL @url ]
        [ WITH ISSUER KEY @key ]
      ]
      [ WITH REFRESH ]
    | BEARER FOR [ USER | RECORD ]
  [ AUTHENTICATE @expression ]
  [ DURATION
    [ FOR GRANT @duration ]
    [ FOR TOKEN @duration ]
    [ FOR SESSION @duration ]
  ]
  [ COMMENT @string ]
```

- [ ] `OVERWRITE` · [ ] `IF NOT EXISTS` · [ ] `ON ROOT` · [ ] `ON NAMESPACE` · [ ] `ON DATABASE`
- [ ] `TYPE JWT ALGORITHM @algorithm KEY @key` · [ ] `TYPE JWT URL @url` · [ ] `TYPE JWT … WITH ISSUER KEY @key` (standalone JWT can issue, not just verify; engine-confirmed — `parse_jwt`, `access_type.rs`. Issuer alg must match the verification alg)
- [ ] `TYPE RECORD` · [ ] `RECORD SIGNUP` · [ ] `RECORD SIGNIN` · [ ] `RECORD WITH JWT (ALGORITHM KEY|URL)` · [ ] `RECORD WITH ISSUER KEY` · [ ] `RECORD WITH REFRESH`
- [ ] `TYPE BEARER FOR USER` · [ ] `TYPE BEARER FOR RECORD`
- [ ] `AUTHENTICATE @expression` · [ ] `DURATION FOR GRANT` · [ ] `DURATION FOR TOKEN` · [ ] `DURATION FOR SESSION` · [ ] `COMMENT @string`

## DEFINE PARAM

```
DEFINE PARAM [ OVERWRITE | IF NOT EXISTS ] $name
    VALUE @value
    [ COMMENT @string ]
    [ PERMISSIONS [ NONE | FULL | WHERE @condition ] ]
```

- [ ] `OVERWRITE` · [ ] `IF NOT EXISTS` · [ ] `$name` · [ ] `VALUE @value` · [ ] `COMMENT @string`
- [ ] `PERMISSIONS NONE` · [ ] `PERMISSIONS FULL` · [ ] `PERMISSIONS WHERE @condition`

## DEFINE NAMESPACE

```
DEFINE NAMESPACE [ OVERWRITE | IF NOT EXISTS ] @name [ COMMENT @string ]
```

- [ ] `OVERWRITE` · [ ] `IF NOT EXISTS` · [ ] `COMMENT @string`

## DEFINE DATABASE

```
DEFINE DATABASE [ OVERWRITE | IF NOT EXISTS ] @name [ STRICT ] [ COMMENT @string ] [ CHANGEFEED @duration [ INCLUDE ORIGINAL ] ]
```

- [ ] `OVERWRITE` · [ ] `IF NOT EXISTS` · [ ] `STRICT` · [ ] `COMMENT @string` · [ ] `CHANGEFEED @duration [ INCLUDE ORIGINAL ]` (database-level changefeed — `define/database.rs`)

## DEFINE USER

```
DEFINE USER [ OVERWRITE | IF NOT EXISTS ] @name
	ON [ ROOT | NAMESPACE | DATABASE ]
	[ PASSWORD @pass | PASSHASH @hash ]
	[ ROLES @roles ]
	[ DURATION ( FOR TOKEN @duration [ , ] [ FOR SESSION @duration ] | FOR SESSION @duration [ , ] [ FOR TOKEN @duration ] ) ]
	[ COMMENT @string ]
```

- [ ] `OVERWRITE` · [ ] `IF NOT EXISTS` · [ ] `ON ROOT` · [ ] `ON NAMESPACE` · [ ] `ON DATABASE`
- [ ] `PASSWORD @pass` · [ ] `PASSHASH @hash` · [ ] `ROLES @roles` · [ ] `DURATION FOR TOKEN` · [ ] `DURATION FOR SESSION` · [ ] `COMMENT @string`

## DEFINE SEQUENCE

```
DEFINE SEQUENCE [ OVERWRITE | IF NOT EXISTS ] @name [ BATCH @batch ] [ START @start ] [ TIMEOUT @duration ]
```

- [ ] `OVERWRITE` · [ ] `IF NOT EXISTS` · [ ] `BATCH @batch` · [ ] `START @start` · [ ] `TIMEOUT @duration`

## DEFINE CONFIG

```
DEFINE CONFIG [ OVERWRITE | IF NOT EXISTS ]
  ( API
      [ MIDDLEWARE @function(...), ... ]
      PERMISSIONS [ NONE | FULL | @expression ]
  | GRAPHQL
      TABLES [ AUTO | NONE | INCLUDE @table, ... | EXCLUDE @table, ... ]
      FUNCTIONS [ AUTO | NONE | INCLUDE @function, ... | EXCLUDE @function, ... ]
      [ DEPTH @integer ]
      [ COMPLEXITY @integer ]
      [ INTROSPECTION NONE ]
  | DEFAULT
      NAMESPACE @namespace
      DATABASE @database
  )
```

- [ ] `OVERWRITE` · [ ] `IF NOT EXISTS`
- [ ] `API MIDDLEWARE @function(...)` · [ ] `API PERMISSIONS [ NONE | FULL | @expression ]`
- [ ] `GRAPHQL TABLES [ AUTO|NONE|INCLUDE|EXCLUDE ]` · [ ] `GRAPHQL FUNCTIONS [ AUTO|NONE|INCLUDE|EXCLUDE ]` · [ ] `GRAPHQL DEPTH` · [ ] `GRAPHQL COMPLEXITY` · [ ] `GRAPHQL INTROSPECTION NONE`
- [ ] `DEFAULT NAMESPACE @namespace DATABASE @database`

## DEFINE BUCKET

```
DEFINE BUCKET [ OVERWRITE | IF NOT EXISTS ] @name
  [ BACKEND @string ]
  [ READONLY ]
  [ PERMISSIONS @expression ]
  [ COMMENT @string ]
```

- [ ] `OVERWRITE` · [ ] `IF NOT EXISTS` · [ ] `BACKEND @string` · [ ] `READONLY` · [ ] `PERMISSIONS @expression` · [ ] `COMMENT @string`

## DEFINE API

```
DEFINE API [ OVERWRITE | IF NOT EXISTS ] @endpoint
    [ FOR @HTTP_method, .. ]
    [ MIDDLEWARE @function, .. ]
    [ THEN { @value } ]
    [ PERMISSIONS [ NONE | FULL | @expression ]
```

- [ ] `OVERWRITE` · [ ] `IF NOT EXISTS` · [ ] `FOR @HTTP_method, …` · [ ] `MIDDLEWARE @function, …` · [ ] `THEN { @value }` · [ ] `PERMISSIONS [ NONE | FULL | @expression ]`

## DEFINE MODULE

```
DEFINE MODULE [ OVERWRITE | IF NOT EXISTS ] @mod::@sub AS @source
  [ COMMENT @string ]
  [ PERMISSIONS [ NONE | FULL | WHERE @condition ] ]
```

> _Feature-gated on the `surrealism` build feature; unavailable in WASM builds (`define/module.rs`)._
> `@source` is a registry ref `silo::@org::@pkg<@major.@minor.@patch>` or an inline file literal `f"…"` — **not** a bare file name.

- [ ] `OVERWRITE` · [ ] `IF NOT EXISTS` · [ ] `@mod::@sub`
- [ ] `AS silo::@org::@pkg<@version>` · [ ] `AS f"…"` (inline) · [ ] `COMMENT @string` · [ ] `PERMISSIONS NONE|FULL|WHERE @condition`

## DEFINE SCOPE _(removed — **not accepted by the v3.1.4 or 3.2-nightly parser**; replaced by `DEFINE ACCESS … TYPE RECORD`. No `SCOPE` dispatch in `parser/stmt/define.rs`. Kept for historical reference only — never pin a coverage item.)_

```
DEFINE SCOPE [ OVERWRITE | IF NOT EXISTS ] @name SESSION @duration SIGNUP @expression SIGNIN @expression [ COMMENT @string ]
```

- [ ] `OVERWRITE` · [ ] `IF NOT EXISTS` · [ ] `SESSION @duration` · [ ] `SIGNUP @expression` · [ ] `SIGNIN @expression` · [ ] `COMMENT @string`

## DEFINE TOKEN _(removed — **not accepted by the v3.1.4 or 3.2-nightly parser**; replaced by `DEFINE ACCESS … TYPE JWT`. No `TOKEN` dispatch in `parser/stmt/define.rs`. Kept for historical reference only — never pin a coverage item.)_

```
DEFINE TOKEN [ OVERWRITE | IF NOT EXISTS ] @name ON [ NAMESPACE | DATABASE | SCOPE @scope ] TYPE @type VALUE @value [ COMMENT @string ]
```

- [ ] `OVERWRITE` · [ ] `IF NOT EXISTS` · [ ] `ON NAMESPACE` · [ ] `ON DATABASE` · [ ] `ON SCOPE @scope` · [ ] `TYPE @type` · [ ] `VALUE @value` · [ ] `COMMENT @string`

## DEFINE MODEL _(not parseable — reserved)_

The `DefineModelStatement` AST struct exists (`sql/statements/define/model.rs`, would serialize as
`DEFINE MODEL [ OVERWRITE | IF NOT EXISTS ] ml::@name<@version> [ COMMENT @string ] PERMISSIONS …`), **but
there is no parser dispatch** for a `MODEL` keyword in `parser/stmt/define.rs` (v3.1.4 and 3.2-nightly), so it
cannot be authored today. Confirmed correctly **omitted** from the authored surface — do not add a coverage item.

---

# REMOVE

```
REMOVE [
    ACCESS    [ IF EXISTS ] @name ON [ ROOT | NAMESPACE | DATABASE ]
  | ANALYZER  [ IF EXISTS ] @name
  | API       [ IF EXISTS ] @name
  | BUCKET    [ IF EXISTS ] @name
  | CONFIG    [ IF EXISTS ] [ GRAPHQL | API | DEFAULT ]
  | DATABASE  [ IF EXISTS ] @name [ AND EXPUNGE ]
  | EVENT     [ IF EXISTS ] @name ON [ TABLE ] @table
  | FIELD     [ IF EXISTS ] @name ON [ TABLE ] @table
  | FUNCTION  [ IF EXISTS ] @name
  | INDEX     [ IF EXISTS ] @name ON [ TABLE ] @table
  | MODULE    [ IF EXISTS ] @name                          -- surrealism-gated
  | NAMESPACE [ IF EXISTS ] @name [ AND EXPUNGE ]
  | PARAM     [ IF EXISTS ] @name
  | SEQUENCE  [ IF EXISTS ] @name
  | TABLE     [ IF EXISTS ] @name [ AND EXPUNGE ]
  | USER      [ IF EXISTS ] @name ON [ ROOT | NAMESPACE | DATABASE ]
]
```

- [ ] `REMOVE … IF EXISTS`
- [ ] `REMOVE ACCESS` (`ON ROOT|NAMESPACE|DATABASE`) · [ ] `REMOVE ANALYZER` · [ ] `REMOVE API` · [ ] `REMOVE BUCKET` · [ ] `REMOVE CONFIG` · [ ] `REMOVE DATABASE`
- [ ] `REMOVE EVENT` · [ ] `REMOVE FIELD` · [ ] `REMOVE FUNCTION` · [ ] `REMOVE INDEX` · [ ] `REMOVE MODULE` _(surrealism-gated)_ · [ ] `REMOVE NAMESPACE`
- [ ] `REMOVE PARAM` · [ ] `REMOVE SEQUENCE` · [ ] `REMOVE TABLE` · [ ] `REMOVE USER`
- [ ] `… AND EXPUNGE` (on `NAMESPACE` / `DATABASE` / `TABLE` — hard-delete vs. tombstone; `parser/stmt/remove.rs`)

---

# ALTER

## ALTER TABLE

```
ALTER TABLE [
	[ IF EXISTS ] @name
		[ DROP COMMENT ]
        [ DROP CHANGEFEED ]
        [ COMPACT ]
		[ SCHEMAFULL | SCHEMALESS ]
		[ PERMISSIONS [ NONE | FULL
			| FOR select @expression
			| FOR create @expression
			| FOR update @expression
			| FOR delete @expression
		] ]
    [ TYPE [ NORMAL | ANY | RELATION [ IN|FROM @table … ] [ OUT|TO @table … ] [ ENFORCED ] ] ]
    [ CHANGEFEED @duration [ INCLUDE ORIGINAL ] ]
    [ COMMENT @string ]
]
```

- [ ] `IF EXISTS` · [ ] `TYPE NORMAL|ANY|RELATION (…)` · [ ] `DROP COMMENT` · [ ] `DROP CHANGEFEED` · [ ] `COMPACT` · [ ] `SCHEMAFULL` · [ ] `SCHEMALESS`
- [ ] `PERMISSIONS NONE|FULL|FOR …` · [ ] `CHANGEFEED @duration` · [ ] `COMMENT @string`

> The earlier draft's trailing bare `[ CHANGEFEED ]` was a copy artifact — the engine parses `CHANGEFEED` once (`alter/table.rs`).

`ALTER` changes an attribute of an existing definition in place (no `REMOVE`+`DEFINE` cycle, no loss of dependents).
v3 dispatches across **17 targets** (`parser/stmt/alter.rs`, `sql/statements/alter/*`), verified against v3.1.4 and
3.2-nightly. Most share the shape `[ IF EXISTS ] @name … [ <clause> | DROP <clause> ] …`.

## ALTER FIELD

```
ALTER FIELD [ IF EXISTS ] @name ON [ TABLE ] @table
    [ TYPE @type | DROP TYPE ]
    [ FLEXIBLE | DROP FLEXIBLE ]
    [ READONLY | DROP READONLY ]
    [ VALUE @expression | DROP VALUE ]
    [ ASSERT @expression | DROP ASSERT ]
    [ DEFAULT [ ALWAYS ] @expression | DROP DEFAULT ]
    [ REFERENCE @reference | DROP REFERENCE ]
    [ PERMISSIONS [ NONE | FULL | FOR select|create|update @expression … ] ]
    [ COMMENT @string | DROP COMMENT ]
```

- [ ] `IF EXISTS` · [ ] `TYPE | DROP TYPE` · [ ] `FLEXIBLE | DROP FLEXIBLE` · [ ] `READONLY | DROP READONLY`
- [ ] `VALUE | DROP VALUE` · [ ] `ASSERT | DROP ASSERT` · [ ] `DEFAULT [ALWAYS] | DROP DEFAULT` · [ ] `REFERENCE | DROP REFERENCE`
- [ ] `PERMISSIONS …` · [ ] `COMMENT @string | DROP COMMENT`

## ALTER INDEX

```
ALTER INDEX [ IF EXISTS ] @name ON [ TABLE ] @table
    [ PREPARE REMOVE ]
    [ COMMENT @string | DROP COMMENT ]
```

- [ ] `IF EXISTS` · [ ] `PREPARE REMOVE` · [ ] `COMMENT @string` · [ ] `DROP COMMENT`

> No `COMPACT` on `ALTER INDEX` (only `COMMENT` / `PREPARE REMOVE`); at least one clause is required (`alter/index.rs`).

## ALTER EVENT

```
ALTER EVENT [ IF EXISTS ] @name ON [ TABLE ] @table
    [ ASYNC [ RETRY @retry ] [ MAXDEPTH @max_depth ] | DROP ASYNC ]
    [ WHEN @condition | DROP WHEN ]
    [ THEN @action … | DROP THEN ]
    [ COMMENT @string | DROP COMMENT ]
```

- [ ] `IF EXISTS` · [ ] `ASYNC … | DROP ASYNC` · [ ] `WHEN | DROP WHEN` · [ ] `THEN | DROP THEN` · [ ] `COMMENT | DROP COMMENT`

## ALTER PARAM

```
ALTER PARAM [ IF EXISTS ] $name
    [ VALUE @expression ]
    [ PERMISSIONS [ NONE | FULL | WHERE @condition ] ]
    [ COMMENT @string | DROP COMMENT ]
```

- [ ] `IF EXISTS` · [ ] `VALUE` · [ ] `PERMISSIONS` · [ ] `COMMENT | DROP COMMENT`

## ALTER SEQUENCE

```
ALTER SEQUENCE [ IF EXISTS ] @name [ TIMEOUT @duration ]
```

- [ ] `IF EXISTS` · [ ] `TIMEOUT @duration`

> Only `TIMEOUT` — no `RESTART` / `START` / `BATCH` on `ALTER SEQUENCE` (`alter/sequence.rs`).

## ALTER USER

```
ALTER USER [ IF EXISTS ] @name ON [ ROOT | NAMESPACE | DATABASE ]
    [ PASSWORD @pass ] [ PASSHASH @hash ]
    [ ROLES @roles ]
    [ DURATION [ FOR TOKEN @duration ] [ FOR SESSION @duration ] ]
    [ COMMENT @string | DROP COMMENT ]
```

- [ ] `IF EXISTS` · [ ] `ON ROOT|NAMESPACE|DATABASE` · [ ] `PASSWORD` · [ ] `PASSHASH` · [ ] `ROLES`
- [ ] `DURATION FOR TOKEN|SESSION` · [ ] `COMMENT | DROP COMMENT`

## ALTER ACCESS

```
ALTER ACCESS [ IF EXISTS ] @name ON [ ROOT | NAMESPACE | DATABASE ]
    [ AUTHENTICATE @expression | DROP AUTHENTICATE ]
    [ DURATION [ FOR GRANT @duration ] [ FOR TOKEN @duration ] [ FOR SESSION @duration ] ]
    [ COMMENT @string | DROP COMMENT ]
```

- [ ] `IF EXISTS` · [ ] `ON ROOT|NAMESPACE|DATABASE` · [ ] `AUTHENTICATE | DROP AUTHENTICATE`
- [ ] `DURATION FOR GRANT|TOKEN|SESSION` · [ ] `COMMENT | DROP COMMENT`

## ALTER ANALYZER

```
ALTER ANALYZER [ IF EXISTS ] @name
    [ FUNCTION fn::@function | DROP FUNCTION ]
    [ TOKENIZERS @tokenizers | DROP TOKENIZERS ]
    [ FILTERS @filters | DROP FILTERS ]
    [ COMMENT @string | DROP COMMENT ]
```

- [ ] `IF EXISTS` · [ ] `FUNCTION | DROP FUNCTION` · [ ] `TOKENIZERS | DROP TOKENIZERS` · [ ] `FILTERS | DROP FILTERS` · [ ] `COMMENT | DROP COMMENT`

## ALTER FUNCTION

```
ALTER FUNCTION [ IF EXISTS ] fn::@name
    [ ( @argument: @type, … ) [ -> @type ] { @block } ]
    [ PERMISSIONS [ NONE | FULL | WHERE @condition ] ]
    [ COMMENT @string | DROP COMMENT ]
```

- [ ] `IF EXISTS` · [ ] `( args ) [ -> @type ] { block }` · [ ] `PERMISSIONS` · [ ] `COMMENT | DROP COMMENT`

## ALTER BUCKET _(files-gated)_

```
ALTER BUCKET [ IF EXISTS ] @name
    [ READONLY | DROP READONLY ]
    [ BACKEND @string | DROP BACKEND ]
    [ PERMISSIONS @expression ]
    [ COMMENT @string | DROP COMMENT ]
```

- [ ] `IF EXISTS` · [ ] `READONLY | DROP READONLY` · [ ] `BACKEND | DROP BACKEND` · [ ] `PERMISSIONS` · [ ] `COMMENT | DROP COMMENT`

## ALTER MODULE _(surrealism-gated)_

```
ALTER MODULE [ IF EXISTS ] @mod::@sub
    [ PERMISSIONS [ NONE | FULL | WHERE @condition ] ]
    [ COMMENT @string | DROP COMMENT ]
```

- [ ] `IF EXISTS` · [ ] `PERMISSIONS` · [ ] `COMMENT | DROP COMMENT`

## ALTER API

```
ALTER API [ IF EXISTS ] @endpoint
    [ FOR any [ @config ] [ THEN { @value } | DROP THEN ] ]
    [ FOR @HTTP_method, … [ @config ] [ THEN { @value } | DROP THEN ] ] …
    [ COMMENT @string | DROP COMMENT ]
```

- [ ] `IF EXISTS` · [ ] `FOR any …` · [ ] `FOR @method …` · [ ] `THEN | DROP THEN` · [ ] `COMMENT | DROP COMMENT`

## ALTER CONFIG

```
ALTER CONFIG [ IF EXISTS ] ( GRAPHQL | API | DEFAULT ) @config
    [ COMMENT @string | DROP COMMENT ]
```

- [ ] `IF EXISTS` · [ ] `GRAPHQL|API|DEFAULT @config` · [ ] `COMMENT | DROP COMMENT`

## ALTER NAMESPACE / ALTER DATABASE

```
ALTER NAMESPACE COMPACT
ALTER DATABASE COMPACT
```

- [ ] `ALTER NAMESPACE COMPACT` · [ ] `ALTER DATABASE COMPACT`

## ALTER SYSTEM

```
ALTER SYSTEM [ COMPACT ] [ QUERY_TIMEOUT @duration | DROP QUERY_TIMEOUT ]
```

- [ ] `COMPACT` · [ ] `QUERY_TIMEOUT @duration` · [ ] `DROP QUERY_TIMEOUT`

---

# REBUILD

```
REBUILD [
	INDEX [ IF EXISTS ] @name ON [ TABLE ] @table [ CONCURRENTLY ]
]
```

- [ ] `REBUILD INDEX` · [ ] `IF EXISTS` · [ ] `ON [ TABLE ] @table` · [ ] `CONCURRENTLY`

---

# INFO

```
INFO FOR [
	ROOT                      [ VERSION @version ] [ STRUCTURE ]
	| NS | NAMESPACE          [ VERSION @version ] [ STRUCTURE ]
	| DB | DATABASE           [ VERSION @version ] [ STRUCTURE ]
	| TABLE @table            [ VERSION @version ] [ STRUCTURE ]
	| USER @user [ ON @level ]                     [ STRUCTURE ]
    | INDEX @index ON @table                       [ STRUCTURE ]
];
```

- [ ] `INFO FOR ROOT` · [ ] `INFO FOR NS|NAMESPACE` · [ ] `INFO FOR DB|DATABASE` · [ ] `INFO FOR TABLE @table` · [ ] `INFO FOR USER @user [ON @level]` · [ ] `INFO FOR INDEX @index ON @table`
- [ ] `… VERSION @version` (point-in-time, on ROOT/NS/DB/TABLE only — not USER/INDEX; `sql/statements/info.rs`)
- [ ] `… STRUCTURE` (the structured form Schemic introspects with)

---

# Data / Query (DML) — the query-layer surface

## SELECT

```
SELECT
    VALUE @field | @fields [ AS @alias ] [ OMIT @fields ... ]
    FROM [ ONLY ] @targets
    [ WITH [ NOINDEX | INDEX @indexes ... ]]
    [ WHERE @conditions ]
    [ SPLIT [ ON ] @field, ... ]
    [
		GROUP [ ALL | [ BY ] @field, ... ] |
		ORDER [ BY ] RAND() | @field [ COLLATE ] [ NUMERIC ] [ ASC | DESC ], ...
	]
    [ LIMIT [ BY ] @limit ]
    [ START [ AT ] @start ]
    [ FETCH @fields ... ]
    [ VERSION @version ]
    [ TIMEOUT @duration ]
    [ TEMPFILES ]
    [ EXPLAIN [ FULL ] ]
;
```

- [ ] `VALUE` · [ ] `@fields [ AS @alias ]` · [ ] `OMIT @fields` · [ ] `FROM [ ONLY ] @targets`
- [ ] `WITH NOINDEX|INDEX` · [ ] `WHERE @conditions` · [ ] `SPLIT [ ON ] @field`
- [ ] `GROUP ALL` · [ ] `GROUP BY @field` · [ ] `ORDER BY @field [ COLLATE ][ NUMERIC ][ ASC|DESC ]` · [ ] `ORDER BY RAND()`
- [ ] `LIMIT [ BY ] @limit` · [ ] `START [ AT ] @start` · [ ] `FETCH @fields` · [ ] `VERSION @version` (time-travel; `expr/statements/select.rs`) · [ ] `TIMEOUT @duration` · [ ] `TEMPFILES` · [ ] `EXPLAIN [ FULL ]`
- _Note: there is **no** `PARALLEL` clause on SELECT (or any DML) in v3.1.4 / 3.2-nightly — `PARALLEL` is a reserved keyword the grammar no longer consumes._

## CREATE

```
CREATE [ ONLY ] @targets
	[ CONTENT @value
	  | SET @field = @value ...
	]
	[ RETURN NONE | RETURN BEFORE | RETURN AFTER | RETURN DIFF | RETURN @statement_param, ... | RETURN VALUE @statement_param ]
	[ TIMEOUT @duration ]
;
```

- [ ] `ONLY` · [ ] `@targets` · [ ] `CONTENT @value` · [ ] `SET @field = @value`
- [ ] `RETURN NONE|BEFORE|AFTER|DIFF|@param|VALUE @param` · [ ] `TIMEOUT @duration`

## INSERT

```
INSERT [ RELATION ] [ IGNORE ] INTO @what
	[ @value
	  | (@fields) VALUES (@values)
		[ ON DUPLICATE KEY UPDATE @field = @value ... ]
	]
	[ RETURN NONE | RETURN BEFORE | RETURN AFTER | RETURN DIFF | RETURN @statement_param, ... | RETURN VALUE @statement_param ]
;
```

- [ ] `RELATION` · [ ] `IGNORE` · [ ] `INTO @what` · [ ] `@value` · [ ] `(@fields) VALUES (@values)` · [ ] `ON DUPLICATE KEY UPDATE` · [ ] `RETURN …`

## UPDATE

```
UPDATE [ ONLY ] @targets
	[ CONTENT @value
	  | MERGE @value
	  | PATCH @value
	  | REPLACE @value
	  | [ SET @field = @value, ... | UNSET @field, ... ]
	]
	[ WHERE @condition ]
	[ RETURN NONE | RETURN BEFORE | RETURN AFTER | RETURN DIFF | RETURN @statement_param, ... | RETURN VALUE @statement_param ]
	[ TIMEOUT @duration ]
	[ EXPLAIN [ FULL ]]
;
```

- [ ] `ONLY` · [ ] `CONTENT` · [ ] `MERGE` · [ ] `PATCH` · [ ] `REPLACE` · [ ] `SET` · [ ] `UNSET` · [ ] `WHERE` · [ ] `RETURN …` · [ ] `TIMEOUT` · [ ] `EXPLAIN [ FULL ]`

## UPSERT

```
UPSERT [ ONLY ] @targets
    [ CONTENT @value
      | MERGE @value
      | PATCH @value
	  | REPLACE @value
      | [ SET @field = @value, ... | UNSET @field, ... ]
    ]
    [ WHERE @condition ]
    [ RETURN NONE | RETURN BEFORE | RETURN AFTER | RETURN DIFF | RETURN @statement_param, ... | RETURN VALUE @statement_param ]
    [ TIMEOUT @duration ]
	[ EXPLAIN [ FULL ] ]
;
```

- [ ] `ONLY` · [ ] `CONTENT` · [ ] `MERGE` · [ ] `PATCH` · [ ] `REPLACE` · [ ] `SET` · [ ] `UNSET` · [ ] `WHERE` · [ ] `RETURN …` · [ ] `TIMEOUT` · [ ] `EXPLAIN [ FULL ]`

## DELETE

```
DELETE [ FROM | ONLY ] @targets
	[ WHERE @condition ]
	[ RETURN NONE | RETURN BEFORE | RETURN AFTER | RETURN DIFF | RETURN @statement_param, ... ]
	[ TIMEOUT @duration ]
	[ EXPLAIN [ FULL ]]
;
```

- [ ] `FROM` · [ ] `ONLY` · [ ] `@targets` · [ ] `WHERE` · [ ] `RETURN …` · [ ] `TIMEOUT` · [ ] `EXPLAIN [ FULL ]`

## RELATE

```
RELATE [ ONLY ] @from_record -> @table | @edge_record -> @to_record    -- NB: no [ OR UPDATE ] in v3.1.4/3.2 (see below)
	[ CONTENT @value
	  | SET @field = @value ...
	]
	[ RETURN NONE | RETURN BEFORE | RETURN AFTER | RETURN DIFF | RETURN @statement_param, ... | RETURN VALUE @statement_param ]
	[ TIMEOUT @duration ]
;
```

- [ ] `ONLY` · [ ] `@from -> @table -> @to` · [ ] `CONTENT` · [ ] `SET` · [ ] `RETURN …` · [ ] `TIMEOUT`
- [ ] `OR UPDATE` — ⚠ **not accepted by the v3.1.4 or 3.2-nightly parser** (no `OR UPDATE` in `parser/stmt/relate.rs` or the `RelateStatement` AST; docs-site only). Tracked but not engine-real.

## LIVE SELECT

```
LIVE SELECT
	[
		[ VALUE ] @fields ... [ AS @alias ]
		| DIFF
	]
	FROM @targets
	[ WHERE @conditions ]
	[ FETCH @fields ... ]
;
```

- [ ] `VALUE @fields [ AS @alias ]` · [ ] `DIFF` · [ ] `FROM @targets` · [ ] `WHERE @conditions` · [ ] `FETCH @fields`

## KILL

```
KILL @value;
```

- [ ] `KILL @value`

---

# Control flow & session

## LET

```
LET $parameter [: @type_name] = @value;
```

- [ ] `LET $parameter = @value` · [ ] `LET $parameter : @type_name = @value`

## RETURN

```
RETURN @value [ FETCH @fields ... ]
```

- [ ] `RETURN @value` · [ ] `RETURN @value FETCH @fields` (`output.rs` carries an optional `FETCH`)

## IF ELSE

```
IF @condition { @expression; .. }
   [ ELSE IF @condition { @expression; .. } ] ...
   [ ELSE { @expression; .. } ]

-- inline form (no braces):
IF @condition THEN @expression
   [ ELSE IF @condition THEN @expression ] ...
   [ ELSE @expression ]
END
```

- [ ] `IF @condition { … }` · [ ] `ELSE IF @condition { … }` · [ ] `ELSE { … }`
- [ ] `IF … THEN … [ ELSE IF … THEN … ] [ ELSE … ] END` (inline form — `ifelse.rs`)

## FOR

```
FOR @item IN @iterable {
@block
};
```

- [ ] `FOR @item IN @iterable { @block }`

## Transactions — BEGIN / COMMIT / CANCEL

```
BEGIN [ TRANSACTION ];
-- statements here
COMMIT [ TRANSACTION ];
-- or
CANCEL [ TRANSACTION ];
```

- [ ] `BEGIN [ TRANSACTION ]` · [ ] `COMMIT [ TRANSACTION ]` · [ ] `CANCEL [ TRANSACTION ]`

## THROW

```
THROW @error
```

- [ ] `THROW @error`

## BREAK

```
BREAK
```

- [ ] `BREAK`

## SLEEP

```
SLEEP @duration;
```

- [ ] `SLEEP @duration`

## USE

```
USE [ NS @ns ] [ DB @db ];
```

- [ ] `USE NS @ns` · [ ] `USE DB @db`

## SHOW

```
SHOW CHANGES FOR [ TABLE @tablename | DATABASE ]
	SINCE @timestamp | @versionstamp
	[ LIMIT @number ]
```

- [ ] `SHOW CHANGES FOR TABLE @tablename` · [ ] `SHOW CHANGES FOR DATABASE` (db-wide changefeed — `show.rs`) · [ ] `SINCE @timestamp|@versionstamp` · [ ] `LIMIT @number`

## ACCESS

```
ACCESS @name [ ON [ ROOT | NAMESPACE | DATABASE ] ]
	GRANT [ FOR USER @name | FOR RECORD @record ]
	| SHOW [ GRANT @id | ALL | WHERE @expression ]
	| REVOKE [ GRANT @id | ALL | WHERE @expression ]
	| PURGE [ EXPIRED | REVOKED [ , EXPIRED | REVOKED ] ] [ FOR @duration ]
```

- [ ] `ACCESS @name ON [ ROOT|NAMESPACE|DATABASE ]`
- [ ] `GRANT FOR USER @name` · [ ] `GRANT FOR RECORD @record`
- [ ] `SHOW [ GRANT @id | ALL | WHERE @expression ]` · [ ] `REVOKE [ GRANT @id | ALL | WHERE @expression ]` · [ ] `PURGE [ EXPIRED|REVOKED ] [ FOR @duration ]`

## CONTINUE

```
CONTINUE
```

- [ ] `CONTINUE`

## OPTION

```
OPTION @name [ = true | false ];
```

- [ ] `OPTION @name` · [ ] `OPTION @name = true|false` _(engine-confirmed — `sql/statements/option.rs`; toggles a per-query execution option, default `true`. Not on the public statements index but real in the parser.)_

## EXPLAIN _(standalone)_

```
EXPLAIN [ ANALYZE ] [ FORMAT TEXT | JSON ] @statement
```

- [ ] `EXPLAIN @statement` · [ ] `EXPLAIN ANALYZE` · [ ] `EXPLAIN FORMAT TEXT|JSON` _(the standalone v3 form, distinct from the `EXPLAIN [ FULL ]` SELECT clause — `sql/expression.rs`)_

---

> **Not included — verified absent from the engine:** `RUN` does **not** exist in the v3.1.4 / 3.2-nightly
> parser or AST (no `RUN` keyword dispatch) — correctly omitted. `OPTION`, by contrast, **does** exist and is
> now documented above (it was wrongly grouped with `RUN` before).
>
> **Status:** all `DEFINE` / `REMOVE` / `ALTER` (17 targets) / `REBUILD` / `INFO` / DML / control-flow grammars
> have been cross-checked against the SurrealDB engine source (tag `v3.1.4`, re-checked on `3.2.0-nightly`).
> Clauses tagged _(engine-confirmed; undocumented on the reference site)_ are real in the parser but absent
> from the public docs. The two ⚠-marked items (`DEFINE INDEX … DEFER`, `RELATE … OR UPDATE`) are the reverse:
> on the docs site but **not** in either engine build — do not pin coverage items to them.
