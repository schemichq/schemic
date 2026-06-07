# surreal-zod DX findings — building `example-tracker`

Dogfooding report from building a full-stack, browser-direct project/task tracker on
`surreal-zod@0.1.0-alpha.0`, against a live SurrealDB **3.1.0**. Verified end to end:
admin migration applies, 12 live integration tests pass, `tsc --noEmit` is clean, and
`vite build` bundles the isomorphic schema for the browser.

The model exercises smart ids, record links + arrays of links, nested objects with
per-field `$default`, enums, datetime, duration, and `$default`/`$assert`/`$readonly`/
`$comment`/`$value`. Findings are ordered by severity within each section.

Legend: **severity** = High (blocks a real use case / needs a workaround that fights the
tool) · Medium (notable friction, easy to trip on) · Low (polish).

---

## What worked well (lead with the good)

- **Isomorphic import is frictionless.** The exact same `src/schema.ts` is imported by the
  bun migration, the bun tests, and the Vite/React browser bundle. No conditional code, no
  shims. Vite resolved `surrealdb` to its browser build via the package's `import` export
  condition automatically; `vite build` produced a clean 343 KB bundle.
- **`decode`/`encode` in the browser are exactly what you want.** Rows come back with
  `RecordId`/`DateTime`/`Uuid`/`Duration` and `decode` turns them into `RecordId`/`Date`/
  `string`/`Duration`/enum app values — on the client, with no extra wiring. `make`/
  `makePartial` build correct `CONTENT`/`MERGE` payloads.
- **Type inference is accurate and load-bearing.** `App<>` ids are `RecordId<"user">` etc.;
  `Create<>` correctly makes DB-filled fields optional (`owner`, `createdAt`, `settings`,
  enum defaults) and required ones required; `Update<>` excludes `id` and `$readonly`
  fields. This drove the whole `web/api.ts` data layer with real safety.
- **DDL generation matched SurrealDB 3.1 with no edits.** Nested objects (`settings.*`),
  arrays of links (`array<record<user>>` + `.*`), relations (`TYPE RELATION FROM..TO`),
  enums/literals (`"todo" | ...`), `duration`, and `DEFAULT/VALUE/ASSERT/READONLY/COMMENT`
  all applied verbatim.
- **`$default(surql\`$auth.id\`)` + `$readonly` is a great pattern.** For `owner`/`author`/
  `createdBy` it pairs perfectly with record access: the client omits the field and the DB
  stamps the authenticated user. Nested-object defaults (`settings: sz.object({...})
  .$default(surql\`{}\`)`) populated child defaults correctly.

---

## Gaps & friction

### 1. No generation for `DEFINE ACCESS` or `PERMISSIONS` — High — PARTIAL
PARTIAL: table + field `PERMISSIONS` are now generated. `TableDef.permissions(spec)` and
`SField.$permissions(spec)` take `true` (FULL) / `false` (NONE) / a `surql` `WHERE` expr /
per-op rules, where an op can be `` `same as <op>` `` to reuse another op's rule; ops with an
identical resolved rule auto-merge into one `FOR a, b …` clause. The tracker's seven tables
now author their row-level rules in `src/schema.ts`; the raw `DEFINE TABLE OVERWRITE … PERMISSIONS`
blocks are gone from `setup.ts`, and the 12 live tests (incl. the isolation checks) still pass.
NOTE the intentional asymmetry: an omitted op defaults to NONE on a table (deny) but to FULL
on a field (the table is the gate) — to lock a field op, set it `false`.

STILL OPEN: `DEFINE ACCESS account ON DATABASE TYPE RECORD` (the `SIGNUP`/`SIGNIN` blocks) is
still hand-written raw SurrealQL in `setup.ts` — there is no `defineAccess(...)` helper yet.
The field-level `PERMISSIONS NONE` for `passhash` is generated (see #2). So the remaining hole
is record access; the schema is no longer only ~60% of what you ship.
**Suggestion:** add a `defineAccess(...)` helper for record access to close this out.

### 2. Internal / write-only / hidden fields can't be modeled — High — RESOLVED
RESOLVED: fields now take a `.$internal()` modifier. It (a) still emits the `DEFINE FIELD`
(so the SCHEMAFULL `SIGNUP` write succeeds) plus `PERMISSIONS NONE`, and (b) is excluded
from `App`/`Create`/`Update` inference (and stripped by `decode`/`make`). Trusted server
code reaches internal fields via a `.system` escape-hatch view (`User.system.decode(row)` /
`User.system.make({ ...passhash })`), typed over the full shape. `passhash` now lives in
`src/schema.ts` as `sz.string().$internal()`; the raw `DEFINE FIELD passhash ... PERMISSIONS
NONE` in `setup.ts` is gone — `defineTable` generates it. The 12 live tests still pass
(signup writes `passhash` via the access block; clients never see it).

`passhash` **must** exist on the SCHEMAFULL `user` table (the record-access `SIGNUP` writes
it) but must **never** appear in `App<User>` and must never be selectable by clients. There
is no concept of a DB-only/hidden field. If I add it to the schema it pollutes the app type
and is selectable; if I omit it, a SCHEMAFULL `CREATE user` during signup would be rejected
unless the field is defined. I ended up defining it entirely in raw SQL:
`DEFINE FIELD passhash ON user TYPE string PERMISSIONS NONE` — outside the schema, so it is
silently un-modeled.
**Suggestion:** a modifier such as `.$internal()` / `.$select(false)` that (a) still emits
the `DEFINE FIELD` (so SCHEMAFULL writes succeed), (b) emits `PERMISSIONS FOR select NONE`,
and (c) is excluded from `App`/`Create`/`Update` inference.

### 3. Attaching PERMISSIONS forces a full-table `OVERWRITE` that drops other config — Medium — RESOLVED
RESOLVED: permissions are now part of `TableConfig` (via `.permissions(...)`), so they are
folded into the single `DEFINE TABLE` that `defineTable` emits — right after `COMMENT`, in the
same statement as `TYPE`/`SCHEMAFULL`. No second `DEFINE TABLE OVERWRITE` is needed, so nothing
has to be restated or kept in sync; a relation keeps its `TYPE RELATION FROM..TO` automatically.

Because permissions aren't part of `TableDef`, the only way to add them after
`defineTable(..., { exists: "overwrite" })` is a second `DEFINE TABLE OVERWRITE <name> ...
PERMISSIONS ...`. `OVERWRITE` replaces the whole table definition, so I had to **restate**
`TYPE NORMAL`/`TYPE RELATION FROM..TO`, `SCHEMAFULL`, and `COMMENT` by hand and keep them in
sync with the schema (a relation that lost its `TYPE RELATION` would silently become a
normal table). `defineTable` also can't emit just the table head, or merge a clause.
(Fields *do* survive a table `OVERWRITE`, which I verified — that part is fine.)
**Suggestion:** fold permissions into the single `DEFINE TABLE` that `defineTable` emits
(depends on #1).

### 4. Zod format/refinement constraints don't become DB `ASSERT`s — Medium — RESOLVED
RESOLVED: assert generation is now explicit and **opt-in by builder** (deliberately NOT
auto-on for arbitrary Zod refinements — silently turning every `.refine()`/transform into an
`ASSERT` would surprise; the builder / `$`-constraint IS the intent). Three sources:
(a) **Format builders bake by default** — `sz.email()` → `ASSERT string::is_email($value)`,
and likewise `url`/`ulid`/`ipv4`/`ipv6`: every format whose `string::is_*` exists on the
server (verified live on **3.1.3**, which uses the underscore form `string::is_email`, **not**
`string::is::email`). Formats with no server validator (`nanoid`/`cuid`/`cuid2`/`xid`/`ksuid`/
`cidrv4`/`cidrv6`/`guid`/`base64`/`base64url`/`e164`/`jwt`/`emoji`) stay assert-free (no
fabricated regex); `sz.uuid()` is the native `uuid` type (no assert).
(b) **`$`-constraints** — `.$min`/`.$max`/`.$length`/`.$regex` (string) and `.$min`/`.$max`/
`.$gt`/`.$gte`/`.$lt`/`.$lte` (number) apply the matching Zod check app-side AND push a
type-aware DB fragment (`string::len($value) >= n`, `$value <= n`, `$value = /re/`, …).
(c) **`.$assert(surql\`…\`)`** still pushes a custom expr; **`.$assert()`** (no args) derives
fragments from the field's existing Zod checks. Fragments AND-combine into one deduped
`ASSERT`. The tracker dropped its hand-written `string::len($value) > 0` asserts for `.$min(1)`,
`email` now gets `string::is_email` for free, and the 12 live tests still pass (the empty-title
rejection rides on `.$min(1)` now).

Original finding:
`sz.email()`, `sz.url()`, the string side of `sz.uuid()`, and `z.string().min()/regex()`,
number ranges, etc. all generate plain `TYPE string`/`TYPE int`. The constraint exists only
app-side (in `decode`/`encode`); the **database stores anything**. e.g. `email` is neither
format-checked nor unique at the DB. I had to add `$assert` and a unique index by hand, and
an empty `title` is only rejected because I wrote `$assert(surql\`string::len($value) >
0\`)` — `sz.string()` alone would have allowed it. This is easy to overlook and creates a
false sense of safety for a browser-direct app where the DB is the only trustworthy gate.
**Suggestion:** optionally translate common refinements (email/url/min/max/length/regex/int
bounds) into `ASSERT`, or at minimum document prominently that formats are app-side only.

### 5. `$value` (computed) fields are required in `Create`/`make()` input — Medium — RESOLVED
RESOLVED: `$value` now takes an options bag, `$value(expr, { optional: true })`, which adds
the `"create"` flag (create-optional) for input-ignoring exprs like `time::now()`; the default
stays create-required for input-consuming exprs like `string::lowercase($value)`. `updatedAt`
dropped its workaround `.optional()`.

`$default`/`$defaultAlways` add the `"create"` flag so the field is optional in `Create<>`
and `make()`. `$value` does **not**, even though a `VALUE` column is *always* computed by
the DB and should never be supplied by the client. `updatedAt: sz.datetime().$value(surql\`
time::now()\`)` was therefore *required* in the create input until I appended `.optional()`
purely to silence it (which also, conveniently, drops the `option<>` in DDL because a
`VALUE` is present). That `.optional()` is noise that misrepresents the field.
**Suggestion:** `$value` should imply create-optional (and arguably update-excluded), the
same way `$default` implies create-optional and `$readonly` implies update-excluded.

### 6. `make()` / `makePartial()` return `Record<string, unknown>` — Low/Medium
The *input* types (`Create`/`Update`) are excellent, but the *output* is untyped, so the
payload handed to `surql\`CREATE ... CONTENT ${...}\`` isn't checked against `Wire<>`. In
practice it's immediately consumed by surql so the blast radius is small, but a typed return
(`Partial<Wire<T>>`) would catch encode-shape bugs and document intent.

### 7. `make()` does not validate against the schema before writing — Low/Medium
`make()` runs `encode` per field but doesn't *parse*: it won't reject values your schema (or
a DB `ASSERT`) would. The empty-title case only fails after the round-trip, at the DB. A
`safeMake`/parse-on-make (or a documented "validate first with `safeEncode`") would let the
client catch invalid input without a server round-trip.

### 8. `.optional().nullable()` emits `option<datetime> | null` — Low — RESOLVED
RESOLVED: the `nullable` DDL case now folds `null` into an existing `option<X>`, so
`.optional().nullable()` emits `option<T | null>` (matching `.nullish()`/`.nullable().optional()`).
`completedAt` now emits `option<datetime | null>` for free. Purely cosmetic — SurrealDB
canonicalizes both forms to `none | T | null`.

Wrapper order leaks into the DDL: `sz.datetime().optional().nullable()` →
`TYPE option<datetime> | null` (redundant — `option<T>` already includes `NONE`), whereas
`.nullable().optional()` → the cleaner `TYPE option<datetime | null>`. SurrealDB 3.1 accepts
both, but the first is confusing and order-dependent.
**Suggestion:** normalize a field that is both optional and nullable to `option<T | null>`
regardless of chaining order.

### 9. Lots of `decode(rows[0])` boilerplate; no data-access layer — Low
Every read is `const [rows] = await db.query(...); X.decode(rows[0])` and every write is
`CREATE/UPDATE ... CONTENT/MERGE ${X.make(...)}` then decode. I wrote a thin `web/api.ts`
(`listProjects`/`createTask`/`updateTask`/…) by hand to remove the repetition. A small
optional helper bound to a `Surreal` instance (`X.create(db, input)` → decoded row,
`X.select(db, id)`, `X.update(db, id, patch)`) would be a big ergonomic win and is a natural
extension given the types already exist.

### 10. Live queries: `decode` isn't wired into `LiveMessage` — Low (works, but manual)
`surreal-zod` plays no part in subscriptions. `db.live(table).subscribe(msg => …)` delivers
`msg.value` as a raw row, so to get app types you'd `X.decode(msg.value)` yourself. I
side-stepped it by re-fetching the (decoded) list on each event, which is fine. A documented
pattern or a tiny `X.decode`-over-`LiveMessage` helper would round out the client story.

---

## Non-package gotcha (recorded for completeness)

- **bun + surrealdb thenable:** `await expect(db.query(...)).rejects.toThrow()` *hangs* under
  `bun test` because `surrealdb`'s `query()` returns a custom `Query` thenable, not a native
  `Promise`, and bun's `expect().rejects` never drives it to settlement. (Tests using
  `signIn(...)`, a real `async` function, reject fine.) Workaround: capture with `try/catch`
  and assert on the error. Not a `surreal-zod` issue, but it cost real debugging time while
  dogfooding, and anyone writing live tests around the package will hit it.

---

## Top 5 (for triage)

| # | Finding | Severity |
|---|---------|----------|
| 1 | No `DEFINE ACCESS` / `PERMISSIONS` generation — PARTIAL: table/field `PERMISSIONS` now generated (`.permissions` / `.$permissions`); `DEFINE ACCESS` still raw | High |
| 2 | ~~Can't model internal/hidden fields (e.g. `passhash`) without leaking into `App`~~ — RESOLVED via `.$internal()` + `.system` | High |
| 3 | ~~Adding permissions forces a full table `OVERWRITE` that restates TYPE/SCHEMAFULL/COMMENT~~ — RESOLVED: folded into the single `DEFINE TABLE` | Medium |
| 4 | ~~Zod format refinements (email/url/min/regex) don't become DB `ASSERT`s~~ — RESOLVED: format builders bake `string::is_*`, `$`-constraints + `.$assert()` push fragments (opt-in by builder) | Medium |
| 5 | `$value` (computed) fields are required in `Create`/`make()` input | Medium |
