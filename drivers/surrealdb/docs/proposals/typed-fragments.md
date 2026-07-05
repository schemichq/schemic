# Typed fragments — mixing the query builder and raw SurrealQL

**Status:** design ratified by Manuel (2026-07-04); phased build below.
**Goal:** the query builder and raw `surql` compose in BOTH directions — a builder is allowed
anywhere a raw tagged query is (including authoring positions), and raw is a first-class escape
hatch inside every builder slot — without giving up type safety where it's expressible.

## The currency: fragments

Everything lowers to a `BoundQuery` fragment: raw templates, builder chains, `Def.call(...)`,
field refs, `surql.*` helpers. Interop = fragments compose. Nested `BoundQuery` composition is
verified SDK behavior; the work is bind NAMESPACING on merge (a fragment's `$b0` never collides
with a sibling's or the outer template's).

**Typing rule (the `[T]` rule).** `surql<R>`'s generic keeps its one meaning: *the per-statement
result tuple*. SurrealDB runs a bare expression as a one-statement query, so an expression of type
`T` IS a query of type `[T]`: `Frag<T> = BoundQuery<[T]>`. Sinks read the single entry —
`.where(...)` accepts `Frag<boolean>`. `surql``.as<T>()` retypes a fragment (ratified — a separate `surql.expr` tag broke editor syntax highlighting).
Untyped `surql` = `Frag<unknown>`, accepted everywhere (gradual typing; no ceremony tax).

**Eager resolution (no markers, no guard).** Our `surql` tag resolves every known value at
template-construction time: a `FunctionDef` splices as `fn::name`, a `TableDef`/`Table` as its
name, a `FieldRef` as its escaped column path, a builder as its lowered `(subquery)` with binds
merged, another `BoundQuery` composes as today. The output is always a PLAIN BoundQuery — it runs
identically through `db.query`, `db.conn.query`, and the DDL emitter. (Manuel's catch: a bare
`fn::x(...)` expression statement evaluates to its value — no `RETURN`, no wedge between paths.)

## Surfaces

### `Def.call(...)` — one object, three uses (ratified; replaces `.call(db, args)`)
```ts
const frag = SendVerificationEmail.call({ email: e.after.email, code: surql`$code` });
// 1. FRAGMENT: interpolate it — surql`{ ...; ${frag}; }` -> fn::send_verification_email(...)
// 2. STANDALONE: await frag.run(conn)
// 3. BOUND: await db.call(SendVerificationEmail, { ... })   // the pre-bound client sugar
```
Args are NAMED and typed from the def's arg shape (missing/extra/misnamed = compile error); each
value is a `Frag`/literal (literals bind as params). Dep edges become structural (the call knows
its def) instead of relying on the `fn::` text scan. BREAKING(alpha): the old runtime signature
`Def.call(db, args)` becomes `Def.call(args).run(db)`.

### `surql.*` helpers (context-FREE surface)
- `surql\`…\`.as<T>()` — typed-fragment retype (see the `[T]` rule).
- `surql.record(Table, idFrag)` — `type::record(<name>, <id>)`, typed table ref.
- `surql.table(Table)` — the escaped table name.
- `surql.$.<path>` — param path proxy (`$after.email`) — UNTYPED here; typing comes from slot
  callbacks (below). Its real role: disambiguating refs from literals in arg positions.
- `surql.fn.<path>(...args)` — SurrealDB's builtin function library, typed, GENERATED from a
  catalog (`surql.fn.crypto.bcrypt.compare(a, b)`, `surql.fn.string.len(x)`, …).

### Typed contextual callbacks (context-DEPENDENT surface)
Every authoring slot that today takes an `Expr` also accepts a CALLBACK receiving a typed context
with exactly the params SurrealDB defines for that position:
```ts
defineEvent(User, "issue_verification", {
  when: (e) => e.event.eq("CREATE"),          // $event: "CREATE"|"UPDATE"|"DELETE"
  then: (e) => surql`{ ... ${e.after.email} ... }`,   // e.after/e.before: typed Row refs
});
password: s.string().$value((f) => surql`crypto::bcrypt::generate(${f.value})`),
slug: s.string().$computed((f) => surql`string::slug(${f.this.title})`),
.permissions({ update: (p) => p.this.author.eq(p.auth.id) })   // $auth via .subject (below)
defineFunction("verify", { email: s.string() }).body((a) => surql`... ${a.email} ...`)
```
Plain `Expr` forms stay (untyped quick path). `$auth` typing: `defineAccess(...).record()
.subject(User)` (ratified name) declares the access's record table; the authoring registry types
`p.auth` as `App<User>` (union across accesses; `unknown` when undeclared).

### Builder ⇄ raw interop
- **Builder inside raw** (incl. `$computed`, event/function bodies, permissions):
  `LET $adults = ${select(User).where((u) => u.age.gte(18))};`
- **Raw inside builder**: `Expr` gains a raw leaf; `where` accepts `Frag<boolean>`;
  `.set((p) => ({ views: p.views.plus(1) }))` — write values as typed frags/ops.
- **Combinators on the chain** (drop the `and`/`or` imports):
  `u.age.gte(18).and(u.email.contains("@corp.com")).and(u.name.length().gt(3))` — `Expr` gets
  `.and/.or/.not`; ref op families grow into the type-mapped stdlib (`.length()` -> `string::len`,
  returning `Frag<number>` so comparisons keep chaining). Catalog-generated, same source as
  `surql.fn`.
- **Statement parity — `block()`** with LET vars typed through the chain:
  ```ts
  block()
    .let("n", select(Post).where((p) => p.author.eq(e.after.id)).count())
    .if((s) => s.n.gt(100), () => NotifyPowerUser.call({ user: e.after.id }))
  ```
  `s.n: Frag<number>` inferred from the let. LET/IF/FOR/RETURN/THROW all take this shape
  (100%-parity bar).
- **`$parent` detection**: a ref used inside a DIFFERENT row context lowers to `$parent.<field>`
  (each ref knows its origin row) — needed for subquery projections:
  `select(User).return((u) => ({ posts: select(Post).where((p) => p.author.eq(u.id)) }))`.

## Also ratified alongside
- **Auto-block**: a multi-statement event/function `then`/body (top-level `;` outside
  strings/braces) is wrapped `{ … }` by the emitter — authors write statements, schemic owns the
  grammar. Round-trip vs introspection must stay drift-free.
- **Lazy refs**: `s.recordId(() => User)` — thunk accepted wherever a table is; names resolve at
  emit/type-derivation (post-module-eval), runtime schema via `z.lazy`. Kills import cycles from
  mutual record links.

## Phases
0. Auto-block; lazy refs; `surql.record/table/$`; eager resolution in the tag. (in progress)
1. Fragments: `[T]` rule + `.as<T>()`; builders interpolatable (bind namespacing); raw leaves in
   `where`; `Expr.and/.or/.not`; `Def.call(...)` fragment+runnable (BREAKING alpha).
2. Typed contextual callbacks (events, field clauses, permissions, function bodies);
   `.subject(User)`.
3. Stdlib catalog (`surql.fn` + typed ref methods); `block()`; `$parent` detection.

Cross-driver: the conventions (fragment typing rule, `Def.call` shape, helper namespace on the
tag, contextual callbacks) mirror to pg on its `sql` tag — flagged to core-dev for ratification;
contents stay dialect-native.
