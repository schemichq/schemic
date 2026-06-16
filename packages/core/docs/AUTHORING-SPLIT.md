# Authoring split — genericizing the `s.*` builder (extraction phase B)

Status: **Approach A — B1 class split DONE.** Follows the engine genericization
(snapshot + diff + migration-runner are already driver-parametric). This phase
makes the **authoring layer** driver-parametric so SurrealDB can be pulled out of
`@schemic/core` and a `@schemic/postgres` builder can plug in the same way.

> **Implementation revision (B1).** The `portableBuilders` factory sketched below
> turned out **not to be cleanly typeable**: a generic `portableBuilders<M>(mk: M)`
> degrades each factory's return to the *base* type (`SFieldBase`), dropping the
> dialect's `$`-methods — TypeScript has no higher-kinded types, so a generic
> factory can't preserve the concrete subclass (`SField<Sc>`) across the call.
> (Verified: `built.string()` types as `SFieldBase<…>`, so `.$default()` is gone.)
> A mapped-type re-narrowing cast per dialect could recover the *non-generic*
> scalar factories, but not the generic ones (`literal`/`enum`/`object`/`array`/…),
> and it adds `as unknown as As<Dialect>` machinery.
>
> **Decision: skip the generic factory.** Each dialect package declares its own
> portable factories — they are trivial one-liners (`() => new SField(z.string())`)
> over the shared `SFieldBase`, which is the actual reuse. This matches the
> industry norm (Zod, Drizzle ship per-dialect builders) and keeps the public types
> precise with zero casts. The "standardized App-land" guarantee is the **shared
> base class + the same `z.*` schemas**, not a shared factory object.
>
> So B1 is **complete** with the class split (`SFieldBase` + `SField`). The code
> blocks below keep `portableBuilders` for context; treat it as illustrative, not
> the shipped shape.

## Goal

Today `pure.ts` (~2300 lines) is the public `s.*` builder and it is entirely
SurrealDB-shaped: `SField` bakes `SurrealMeta` (whose fields are `BoundQuery`
from the surrealdb SDK), `RecordIdField extends SField`, and every `$`-method
authors SurrealQL.

The chosen end state (per the multi-DB decisions): **one `s.*` namespace,
standardized App-land, per-DB Wire/native layer**. Concretely:

- The **portable** part of `s.*` — the zod-native field factories (`s.string()`,
  `s.int()`, `s.datetime()`, `s.email()`, …) and the portable chainable wrappers
  (`.optional()`, `.array()`, `.default()`, codecs) — lives in `@schemic/core`.
- The **native** part — `SurrealMeta`, `RecordId`, the `string::is_*` format
  fields, every `$`-method (`$default`/`$assert`/`$computed`/`$permissions`/…) —
  lives in `@schemic/surrealdb`, which extends the core base and re-exports a single
  `s` that is a drop-in superset.
- A second driver (`@schemic/postgres`) plugs in by the **same mechanism**: its
  own field subclass + native metadata + native `$`-methods, re-exporting its own
  `s`.

## The core problem: fluent chaining across two concerns

`SField` must stay fluent while a chain mixes:

- **Portable** wrappers (`.optional()`, `.email()`, `.array()`) — change the schema
  generic `S`, dialect-agnostic.
- **Native** authoring (`.$default()`, `.$assert()`) — change `Flags`, dialect-
  specific (the metadata is `SurrealMeta`, holding `BoundQuery`s).

`s.string().$default(x).optional().$assert(y)` must keep **both** method sets
alive across the whole chain. Preserving the concrete dialect type through
generic, schema-changing methods is the design challenge.

## Approach A (chosen): portable base + dialect subclass

The base class in `@schemic/core` holds **only portable** methods plus an opaque
`native` slot. A protected `rebuild` hook constructs the *concrete dialect* class
at runtime; each dialect subclass adds its native `$`-methods and `declare`-
retypes the inherited portable wrappers (signature-only — zero runtime cost) so
chaining preserves the dialect's type.

```ts
// ========== @schemic/core: the portable base ==========
export abstract class SField<
  S extends z.ZodType,
  Flags extends string = never,
  N = unknown,
> {
  constructor(
    readonly schema: S,
    readonly native: N,
  ) {}

  /** Rebuild a sibling of the SAME dialect with a new schema/flags. Each dialect overrides it. */
  protected abstract rebuild<S2 extends z.ZodType, F2 extends string>(
    schema: S2,
    native: N,
  ): SField<S2, F2, N>;

  // Portable wrappers — bodies live ONCE here; runtime returns the dialect
  // subclass via rebuild(), so chains never "fall back" to the base type.
  optional(): SField<z.ZodOptional<S>, Flags, N> {
    return this.rebuild(this.schema.optional(), this.native);
  }
  array(): SField<z.ZodArray<S>, Flags, N> {
    return this.rebuild(z.array(this.schema), this.native);
  }
  // ...all the existing codec methods (decode/encode/...) and zod wrappers
  //    (nullable/default/prefault/catch/nullish/or/and/...), unchanged...
  decode(value: unknown): z.output<S> {
    return z.decode(this.schema, value as never);
  }
}

/** Build the portable `s.*` factories bound to a dialect's field constructor. */
export function portableBuilders<F extends SField<z.ZodType, never, unknown>>(
  mk: (schema: z.ZodType, native: unknown) => F,
) {
  return {
    string: () => mk(z.string(), {}),
    number: () => mk(z.number(), {}),
    boolean: () => mk(z.boolean(), {}),
    int: (p?: Parameters<typeof z.int>[0]) => mk(z.int(p), {}),
    float: (p?: Parameters<typeof z.float64>[0]) => mk(z.float64(p), {}),
    datetime: () => mk(datetimeCodec(), {}),
    email: () => mk(z.email(), {}),
    url: (p?: Parameters<typeof z.url>[0]) => mk(z.url(p), {}),
    // ...the portable subset only — NOT the string::is_* formats, uuid, recordId...
  };
  // (typed so each factory returns the concrete F with the right schema generic;
  //  see the implementation for the exact mapped-return typing.)
}
```

```ts
// ========== @schemic/surrealdb: the dialect extension ==========
export class SurrealField<S extends z.ZodType, Flags extends string = never>
  extends SField<S, Flags, SurrealMeta>
{
  protected rebuild<S2 extends z.ZodType, F2 extends string>(
    schema: S2,
    native: SurrealMeta,
  ) {
    return new SurrealField<S2, F2>(schema, native); // chains stay SurrealField
  }

  // Type-only narrowing of inherited portable wrappers (no bodies — the runtime
  // implementation comes from the base, which constructs SurrealField via rebuild):
  declare optional: () => SurrealField<z.ZodOptional<S>, Flags>;
  declare array: () => SurrealField<z.ZodArray<S>, Flags>;
  // ...one `declare` per inherited portable wrapper...

  // Native authoring — the surql/$-methods live HERE, exactly as today:
  $default(v: z.output<S> | BoundQuery): SurrealField<S, Flags | "create"> {
    return new SurrealField(this.schema, { ...this.native, default: toExpr(v) });
  }
  $assert(e?: BoundQuery): SurrealField<S, Flags> {
    /* push to native.asserts */
  }
}

const portable = portableBuilders((schema, n) => new SurrealField(schema, n));
export const s = {
  ...portable, // standardized App-land (zod natives)
  uuid: () => new SurrealField(uuidCodec(), {}), // surreal natives
  recordId: (t) => new RecordIdField(t),
  alpha: () => surrealFormat("alpha"), // string::is_* formats
  // ...alphanum/ascii/numeric/semver/.../ip/domain...
};
```

```ts
// ========== @schemic/postgres: the SAME mechanism (the generalization proof) ==========
export interface PgMeta {
  default?: SqlExpr;
  check?: SqlExpr[];
  generated?: SqlExpr;
}

export class PgField<S extends z.ZodType, Flags extends string = never>
  extends SField<S, Flags, PgMeta>
{
  protected rebuild<S2 extends z.ZodType, F2 extends string>(s: S2, n: PgMeta) {
    return new PgField<S2, F2>(s, n);
  }
  declare optional: () => PgField<z.ZodOptional<S>, Flags>;
  // ...

  $default(v: z.output<S> | SqlExpr): PgField<S, Flags | "create"> {
    /* … */
  }
  $check(e: SqlExpr): PgField<S, Flags> {
    /* pg-native — NOT surreal's $assert */
  }
}

export const s = {
  ...portableBuilders((schema, n) => new PgField(schema, n)),
  serial: () => new PgField(z.int(), { generated: sql`identity` }),
  jsonb: <T extends z.ZodType>(t: T) => new PgField(t, {}),
};
```

### Why A

- Idiomatic OO; perfect IDE types across the chain.
- Native method *sets* differ freely per dialect (surreal `$assert` vs pg `$check`)
  — no forced union, no untyped escape hatch.
- A new driver's authoring is a parallel ~30-line subclass + its own `s`.

### Cost (accepted)

Each dialect `declare`-retypes the portable wrappers it narrows (mechanical,
~15 lines). Adding a portable wrapper to the base means adding one `declare` line
per dialect. Decision: explicit `declare` is **more** readable for contributors
than F-bounded `Self`-type generic gymnastics that would auto-preserve the type.

## Alternatives considered

### B — one class + injected dialect strategy (composition)

A single `SField<S, Flags, D extends Dialect>`; the `$`-methods delegate to
`this.dialect.ops`. No subclasses, no HKT.

```ts
class SField<S, Flags, D extends Dialect> {
  constructor(schema: S, readonly d: D, readonly native: D["meta"]) {}
  optional() { return new SField(this.schema.optional(), this.d, this.native); }
  $default(v: z.output<S> | D["expr"]) {
    return new SField(this.schema, this.d, this.d.ops.default(this.native, v));
  }
}
```

Rejected: the native method *set* is fixed across all dialects (a union), so
surreal-only `$assert` and pg-only `$check` can't coexist cleanly without an
untyped `.$(patch)` escape hatch — a worse contributor API.

### C — structural contract only (Drizzle-style)

Core defines interfaces; each dialect ships a fully independent `s`. Maximum
decoupling, but the portable factories (`string`/`int`/…) get **duplicated** in
every dialect package — the opposite of "standardized App-land in core".

## The engine contract

The engine (the driver-neutral orchestration in `cli/*` + the `Driver`
interface) consumes only the **authoring contract** from the builder:
`TableDef`, `Shape`, `StandaloneDef`, and the base `SField` type — the things
`driver.lower(tables, defs)`, the schema-loader, and `migrate` pass around. These
stay in `@schemic/core`. The driver reads `SField.schema` (portable) and
`SField.native` (its own metadata); only the surreal driver interprets
`SurrealMeta`. The dialect-specific lowering (`cli/lower.ts` → Struct) and DDL
(`ddl.ts`, `cli/structure.ts`, …) are already behind `surrealDriver` and move out
in phase C.

## Staging (keeps every test green until the physical move)

- **B1 — done (refactor in place, inside `@schemic/core`).** Extracted the portable
  base `SFieldBase`; `SField extends SFieldBase<…, SurrealMeta>` is the extension
  (here it's named `SField`, not `SurrealField` — keeping the public name minimizes
  churn; it can be renamed at the physical move). No generic `portableBuilders` (see
  the revision note at the top); `s` is unchanged. Behavior identical; tests still
  `import { s, defineTable } from "@schemic/core"` and pass unchanged.
- **C — physical extraction.** Move `SField` (the extension) + natives + `ddl.ts` +
  the surreal `cli/*` modules to `@schemic/surrealdb`; have core publicly export the
  authoring contract (`SFieldBase`/`TableDef`/`Shape`/`StandaloneDef`) + `Driver`/
  portable types + `ResolvedConfig`; re-point examples/docs/tests. Add
  `@schemic/postgres` authoring as the parallel `PgField extends SFieldBase` subclass
  with its own per-dialect portable factories.

This is the only phase that touches import paths; B1 does not.
