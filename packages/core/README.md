# surreal-zod

Author [SurrealDB](https://surrealdb.com) schemas with [Zod](https://zod.dev).

- **`sz.*`** — a drop-in for `z.*` that also carries SurrealQL metadata.
- **`defineTable` / `defineField`** — generate `DEFINE TABLE` / `DEFINE FIELD` DDL from your schema.
- **`decode` / `encode`** — map DB rows ⇄ app objects across Zod's two channels via codecs
  (`DateTime`⇄`Date`, `Uuid`⇄`string`, `RecordId`, …).

## Install

```bash
bun add surreal-zod surrealdb zod
```

`surrealdb` and `zod` are peer dependencies.

## Quick start

```ts
import { sz, table, relation, defineTable, type App } from "surreal-zod";
import { surql } from "surrealdb";

export const User = table("user", {
  id: sz.string(),                                  // -> record<user>
  name: sz.string(),
  email: sz.email(),
  status: sz.string().$default("pending"),          // DB-side DEFAULT
  createdAt: sz.datetime().$default(surql`time::now()`).$readonly(),
});

export const Friend = relation("friend", {
  strength: sz.number().$gte(0).$lte(1), // -> ASSERT $value >= 0 AND $value <= 1
})
  .from(User)
  .to(User);

// SurrealQL DDL:
console.log(defineTable(User));
// DEFINE TABLE user TYPE NORMAL SCHEMAFULL;
// DEFINE FIELD name ON TABLE user TYPE string;
// ...

// Build a CREATE payload (DB-filled fields optional), then decode a row back:
const payload = User.make({ name: "Alice", email: "alice@example.com" });
type AppUser = App<typeof User>; // id: RecordId, createdAt: Date, ...
```

See [`examples/`](./examples) for a full schema, a live demo (`bun examples/demo.ts`),
and a small CRUD server.

## Permissions

Author row-level `PERMISSIONS` with `TableDef.permissions(spec)` and `SField.$permissions(spec)`.
A `spec` is `true` (FULL) / `false` (NONE) / a `surql` `WHERE` expr (shared by every op) / a
per-op object. In a per-op object each op is `true`/`false`/a `surql` expr, or `` `same as <op>` ``
to reuse another op's rule; ops with an identical resolved rule auto-merge into one `FOR a, b …`
clause. Table permissions cover `select`/`create`/`update`/`delete`; **fields have no `delete`** op.

```ts
table("project", {
  owner: User.record().$default(surql`$auth.id`).$readonly(),
  // ...
}).permissions({
  select: surql`owner = $auth.id OR settings.isPublic = true`,
  create: surql`owner = $auth.id`,
  update: "same as create",
  delete: "same as create",
});
```

Table permissions fold into the single generated `DEFINE TABLE` (no separate `OVERWRITE`).
**Omitted-op asymmetry** (it mirrors SurrealDB's own defaults): an omitted op defaults to
**NONE** (deny) on a *table* but to **FULL** on a *field* — the table is the gate, so to lock a
field op you must set it `false` explicitly.

## Asserts / constraints

A field can accumulate several `ASSERT` fragments that AND-combine into one `ASSERT`
clause (deduped, order preserved). There are three sources:

- **Format builders bake by default.** `sz.email()` → `ASSERT string::is_email($value)`,
  `sz.url()` → `string::is_url`, and likewise `ulid` / `ipv4` / `ipv6` — i.e. every
  builder whose `string::is_*` validator exists on the server. SurrealDB **3.x** uses the
  underscore form (`string::is_email`, **not** `string::is::email`). Formats with no
  server validator (`nanoid`, `cuid`/`cuid2`, `xid`, `ksuid`, `cidrv4`/`cidrv6`, `guid`,
  `base64`/`base64url`, `e164`, `jwt`, `emoji`) stay assert-free — no fabricated regex.
  `sz.uuid()` is the native `uuid` type (no assert).
- **`$`-constraints** apply the matching Zod check app-side **and** push a type-aware DB
  fragment (string vs. number is read from the schema):
  - `.$min(n)` / `.$max(n)` — string: `string::len($value) >= n` / `<= n`; number: `$value >= n` / `<= n`
  - `.$length(n)` — string: `string::len($value) == n`
  - `.$regex(/re/)` — string: `$value = /re/`
  - `.$gt(n)` / `.$gte(n)` / `.$lt(n)` / `.$lte(n)` — number: `$value > / >= / < / <= n`
- **`.$assert(...)`** — `.$assert(surql\`…\`)` pushes a custom fragment; `.$assert()` (no
  args) derives fragments from the field's existing Zod checks (formats, length, regex,
  number bounds), best-effort.

```ts
sz.string().$min(1).$max(120);                 // string::len($value) >= 1 AND ... <= 120
sz.number().$gte(0).$lte(1);                    // $value >= 0 AND $value <= 1
sz.email().$assert(surql`$value != $forbidden`); // string::is_email($value) AND $value != $forbidden
```

## Develop

```bash
bun test          # unit + live (live skips when no SurrealDB is reachable)
bun run typecheck
bun run build     # -> lib/ (ESM + d.ts) via tsup
```
