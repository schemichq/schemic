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
const payload = User.encode({ name: "Alice", email: "alice@example.com" });
type AppUser = App<typeof User>; // id: RecordId, createdAt: Date, ...
```

### Reading & writing

The whole JS ⇄ DB mapping rides on Zod's two codec channels:

- **`decode`** (read, wire → app) turns a DB row into your app object (`DateTime` → `Date`,
  `Uuid` → `string`, `RecordId`, …).
- **`encode` / `encodePartial`** (write, app → wire) build a payload. They're **create/patch-
  shaped**: DB-filled fields (`$default`, `id`) are *optional* (the DB fills them), absent keys
  are omitted, and each provided value is validated. Use `encode` with `CONTENT` (create) and
  `encodePartial` with `MERGE` (patch).
- `parse*` are kept as **`@deprecated`** aliases of `decode*` (for `z`-API familiarity).

`encode` / `encodePartial` return a typed `Partial<Wire<T>>` (codec fields are wire-typed —
`createdAt` is a `DateTime`, not a `Date`). They **throw** a `ZodError` on invalid input. For
the non-throwing form use `safeEncode` / `safeEncodePartial`, which return a Zod-style
`{ success: true; data } | { success: false; error }` (all field errors aggregated into one
`ZodError`). Each has an async twin (`encodeAsync` / `safeEncodeAsync` / …) for async
refinements. `TableDef.system.{encode,safeEncode,…}` are the same over the full shape,
including `$internal()` fields. If you ever need the **raw full-object codec** (no create-
shaping), that's just `z.encode(table.object, app)`.

Field-level codecs work the same way directly on a field:

```ts
sz.datetime().decode(dbDateTime); // -> Date
sz.datetime().encode(new Date()); // -> DateTime
sz.uuid().encode("0190b6e0-…");   // -> Uuid
```

See [`examples/`](./examples) for a full schema, a live demo (`bun examples/demo.ts`),
and a small CRUD server.

## Nested objects

`sz.object({ ... })` builds a nested SurrealQL `object`, and surreal-zod looks *through* it so
each nested field keeps its own DDL metadata and create-optionality:

- A nested field with a DB `$default` (or `$value(..., { optional: true })`) is
  **create-optional** in `encode` — omit it and the DB fills it — exactly like a top-level
  defaulted field. So you can pass a *partial* nested object and let the DB complete it:

  ```ts
  const Project = table("project", {
    name: sz.string(),
    settings: sz.object({
      isPublic: sz.boolean().$default(surql`false`),
      defaultView: sz.enum(["list", "board"]).$default("list"),
    }),
  });

  Project.encode({ name: "Launch", settings: { defaultView: "board" } });
  // -> { name, settings: { defaultView: "board" } }   (the DB fills settings.isPublic)
  ```

- On the **decoded** side those nested fields stay **required** in `App<T>` — a stored row has
  them — consistent with how top-level defaulted fields behave.

### `encode` (CONTENT) vs `encodePartial` (MERGE)

`encode` builds a **`CONTENT`** payload; `encodePartial` builds a **deep-partial `MERGE`**
payload — every nested key is optional, mirroring SurrealDB's `MERGE`, which **recursively
deep-merges** (siblings are preserved at every level):

```ts
Project.encodePartial({ settings: { defaultView: "board" } });
// -> { settings: { defaultView: "board" } }   ->   UPDATE $id MERGE $payload
```

The library only **builds the payload** — you choose the statement. Pair `encode` with `CONTENT`
and `encodePartial` with `MERGE`. **Warning:** sending a *partial* payload with `CONTENT`
**replaces** the record (unsupplied fields are dropped); use `MERGE` for partial writes.

### Atomic (object-level) validation

Only objects built with `sz.object` are flattened/recursed. A field that holds a **raw, refined
`z.object`** is validated **atomically** — provide it whole, and its object-level `refine` runs:

```ts
import { z } from "zod";

table("booking", {
  // validated all-or-nothing; the refine runs on the whole object
  range: z.object({ from: z.number(), to: z.number() }).refine((r) => r.from <= r.to),
});
```

That's the built-in escape when you want all-or-nothing / object-level checks. For full manual
control, build the payload yourself and pass it via `surql` — `encode`/`encodePartial` are just
conveniences, not a requirement.

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

## Live queries

There's no special live API — a subscription payload is just a row, so decode it exactly like
a query result:

```ts
await db.live("user", (action, value) => {
  if (action === "CLOSE") return;
  const user = User.decode(value); // decoded App<User> — RecordId, Date, …
});
```

A typed query + live layer (results decoded automatically) is planned in `surreal-zod/orm`.

## Develop

```bash
bun test          # unit + live (live skips when no SurrealDB is reachable)
bun run typecheck
bun run build     # -> lib/ (ESM + d.ts) via tsup
```
