# Table presets — `defineTable.preset()` + `TableDef.use()`

**Status:** ratified cross-driver (core-dev), implemented in `@schemic/surrealdb`.
**Origin:** gulybyte's real-world `tenantTableSchema` helper (tenant column + timestamps +
tenant-scoped permissions + guard event, stamped onto every table), generalized into a
first-class composition primitive.

## Shape

```ts
// A preset is a reusable BUNDLE of table parts — it emits nothing on its own:
const tenant = (field: string) =>
  defineTable.preset({
    columns: { [field]: s.string().$readonly() },
    permissions: surql`$auth.org != NONE`,          // ANDs into every op
    events: [{ name: "tenant_guard", when: …, then: … }],
    indexes: [{ name: `by_${field}`, fields: [field] }],
  });

const timestamps = () =>
  defineTable.preset({
    columns: {
      createdAt: s.datetime().$default(surql`time::now()`).$readonly(),
      updatedAt: s.datetime().$value(surql`time::now()`),
    },
  });

// Applied via CHAINED single-arg .use — full column typing at any depth:
const Post = defineTable("post", { title: s.string() })
  .use(tenant("org_id"))
  .use(timestamps());
// Post.fields.org_id / .createdAt are REAL typed fields; .create/.update see their flags.
```

Configurable presets are **plain functions** returning `defineTable.preset(...)` — no bespoke
factory API. Placement is deliberate: a preset composes onto tables (it never becomes a schema
object itself), so it hangs off `defineTable`, not the `define*` family, and is **not** in `s.*`.

## Semantics (the ratified cross-driver contract)

| slot | semantics |
|---|---|
| `columns` | **typed-merge** into the row (and the derived `.create`/`.update`/`.object`). Any name clash — preset-vs-table or preset-vs-preset — is a **compile error** (`PresetColumnConflict<K>` names the key) backed by a runtime throw. No silent clobber. |
| `permissions` | per-op **AND-combine** with the table's own + earlier presets' — a preset can only **narrow** access, never widen. `false` absorbs, `true` is the identity, exprs AND together. `same as X` refs resolve to concrete rules first. (Permission combining is dialect-native per the ratified amendment; AND is the surreal model.) |
| `events` | **append** (table-scoped names). |
| `indexes` | **append**. |

The four slot **names** are the cross-driver contract; contents are dialect-specific
(surreal `TablePermissions`/events vs pg RLS/triggers).

## Why single-arg chained `.use(a).use(b)` (not variadic)

Both variadic typing strategies — `UnionToIntersection<PresetCols<Ps[number]>>` over a tuple
and an intersected variadic arg-constraint — **crash tsc 5.9.3** (`getSignatureApplicabilityError`
Debug Failure), and fixed-arity overloads cap type safety at their arity (a typesafe→untyped
downgrade past the cap — rejected). Chaining keeps full column typing and compile-time conflict
detection at any depth: each `.use` re-checks its preset against the table-so-far, so
preset-vs-preset clashes surface too. Revisit variadic on a tsc upgrade.

## DB-canonical permission combining (no `diff --live` phantoms)

SurrealDB strips redundant parens in `INFO … STRUCTURE` (verified live on 3.1.4):
`(a) AND (b)` comes back as `a AND b`, while precedence-required parens
(`(a OR b) AND c`) round-trip verbatim. `andPerm` therefore emits the DB-canonical form —
an operand is parenthesized **only** when it contains a top-level `OR`/`||` — so a
preset-composed table is `diff --live`-clean (live-verified: authored struct ≡ introspected
struct, idempotent re-apply).

Known pre-existing gap (not preset-specific, noted while verifying): the DB also canonicalizes
string-literal quotes in exprs (`"UPDATE"` → `'UPDATE'`); an authored double-quoted literal in
any expr (event `when`, etc.) diffs textually against introspection.
