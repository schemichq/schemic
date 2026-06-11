# What you're documenting: surreal-zod

This is the settled context for every doc. Treat it as the project's reality, not
a starting point to re-derive. Where a specific signature or behavior matters,
the source in `packages/core/src` is authoritative — verify there before you
document an exact flag, default, or output.

## One-line identity

surreal-zod lets you describe a SurrealDB table once, in Zod, and get three things
from that single definition: SurrealQL **DDL**, runtime **validation**, and a
fully-typed **JS⇄DB mapping**. No code generation step, no separate schema
language — your Zod schema *is* the schema.

Package name: `surreal-zod` (monorepo `packages/core`). Status: `0.1.0-alpha` —
the API still churns; flag breaking changes loudly in any changelog or release note.

## Audience

TypeScript developers building on SurrealDB. Assume they:

- are fluent in TypeScript and comfortable with Zod (or pick it up fast);
- may be **newer to SurrealDB and SurrealQL** — define SurrealQL terms (DDL,
  `DEFINE TABLE`, `ASSERT`, `RELATE`, record links) on first use, but don't
  re-teach TypeScript or Zod basics;
- want one source of truth instead of hand-syncing a schema, validators, and types.

Write for that reader. Don't ask who they are.

## The core mental model — get this right

A field is a stock Zod schema plus a little SurrealQL metadata. The JS⇄DB mapping
rides Zod's **two native channels**:

- **encoded** side = `z.input` = the **DB wire type** (what SurrealDB stores/returns)
- **decoded** side = `z.output` = your **app type** (what you work with in TS)

So a `datetime` is a `DateTime` on the wire and a `Date` in your code — for free,
via a codec. **Never blur these two sides.** Mixing up `encode`/`decode` or
`Wire`/`App` in a doc is a correctness bug, not a style nit.

- `encode(app)` → wire (app → DB), `decode(row)` → app (DB → app).
- `encodePartial(patch)` → a partial wire payload for `UPDATE`/`MERGE`/PATCH bodies.

Built-in codecs include: `DateTime ⇄ Date`, `Uuid ⇄ string`, `RecordId`, and
bytes ⇄ `Uint8Array`.

## Public API surface (imported from `surreal-zod`)

- **`sz`** — a drop-in for `z.*` that also carries SurrealQL metadata. Use it
  wherever you'd use `z` (`sz.string()`, `sz.email()`, `sz.datetime()`,
  `sz.uuid()`, `sz.number()`, `sz.recordId("user")`, …). `sz.email()` knows to
  emit `ASSERT string::is_email($value)`.
- **`table(name, shape)`** → a `TableDef`. The `id` field controls the record id
  type (`sz.string()` → `record<table, string>`; omit → `record<table>`).
  Carries codec methods (`encode`, `decode`, `encodePartial`) and chainable
  config: `.comment(...)`, `.schemafull()` / `.schemaless()` / `.drop()`,
  `.record()` (a typed `record<...>` link, `.array()` for a list), and the Zod
  set ops `.pick` / `.omit` / `.partial` / `.extend` (each returns a full
  `TableDef` again, with its own DDL and codecs).
- **`relation(name, fields?)`** → an edge table (`RelationDef`). Chain
  `.from(X).to(Y)` to set endpoints; exposes typed `in` / `out`. Written with
  `RELATE`, read back with `decode` like any table.
- **`defineTable(def)`** → the SurrealQL DDL **string** (`DEFINE TABLE` /
  `DEFINE FIELD …`). Sibling emitters exist for the other DDL kinds
  (`defineRelation`, `defineEvent`, `defineFunction`, `defineAccess`).
- **Types:** `App<typeof X>` (the decoded app type), plus `Create`, `Update`,
  and `Wire` for the create/update/wire shapes.
- **`surql`** — re-exported from the `surrealdb` SDK; authors SurrealQL
  expressions for field defaults, asserts, and permission/event bodies, e.g.
  `sz.datetime().$default(surql\`time::now()\`)`.

### Field metadata helpers (chainable, on top of Zod's own)

- `.$default(expr)` — DB-side `DEFAULT` (often a `surql\`...\`` expression).
- `.$readonly()` — `READONLY` field.
- `.optional()`, `.array()`, and the rest of Zod's combinators carry through.

### DDL features the library can express

`DEFINE TABLE`/`FIELD`, `ASSERT` (constraints), `DEFAULT`, `PERMISSIONS`,
schemafull/schemaless, `COMMENT`, indexes, events, functions, and access
(`RECORD` / `JWT` / `BEARER`), including nested object fields.

## The CLI (`surreal-zod`, alias `sz`)

A declarative, **diff-based** migration tool: it compares your TypeScript schema
against the live database and generates migrations (with `IF $direction` up/down
bodies). Subcommands include `init`, `gen`, `diff`, `status`, `pull`, and
`schema`. (Confirm exact flags in `packages/core/src/cli` before documenting them.)

## Monorepo layout

- `packages/core` — the `surreal-zod` library **and** the CLI.
- `packages/docs` — the documentation site (the docs you'll be writing live in
  `packages/docs/content/docs`).
- `packages/example-tracker`, `packages/example-credilisto`, `packages/example-git`
  — example apps; good sources of realistic, working sample code.

## Versions and SurrealQL gotchas

- JS SDK is **v2.x**; it targets SurrealDB **server v3.x**.
- Server 3.x uses underscore function names (e.g. `string::is_email`,
  not `string::isEmail`). Match the server version the docs target.
- A `record<table>` link is a `RecordId` on the wire; in surrealdb's SDK a
  `RecordId.table` is a `Table` object — use `.table.name`, don't `String()` it.

## Terminology to keep consistent

- **encoded / wire / DB side** = `z.input`; **decoded / app side** = `z.output`.
  Pick one pair of words per doc and stick to it.
- **DDL** = the SurrealQL `DEFINE …` text the library emits.
- **field** = a `sz.*` schema + SurrealQL metadata; **table** / **relation** =
  what `table()` / `relation()` return.
- Prefer realistic example domains (a `user`/`post` blog, or borrow from the
  example apps) and reuse the same one across a page.
