# Authoring convention: the chainable escape-hatch method `.$<driver>(wire, codec?)`

> A **documentation convention**, not core code: `@schemic/core`'s `SFieldBase`
> stays dialect-neutral; each driver owns its dialect-named method. Greenlit by
> Manuel (2026-06-18) per the standing directive "all drivers must expose a
> chainable `.$<driver>` method".

## Convention

Every driver **MUST** expose, on its `SFieldBase` subclass, a chainable
escape-hatch method named for the dialect:

```
.$<drivername>(wire, codec?)
```

- **`<drivername>`** = the driver's slug (`.$surreal`, `.$postgres`, `.$mysql`, …).
- **`wire`**: an `s.*` field (or a raw Zod type) that supplies the **storage /
  DDL type** of the column.
- **`codec?`**: optional `{ encode(app): wire; decode(wire): app }`. Omitted →
  identity mapping (the app value is stored as-is).

### Semantics (MUST)

The method returns a NEW field such that:

- the emitted **column / DDL type is the `wire` field's type**;
- the **App type is `this`** (the field the method is chained onto);
- the field's Zod schema is `z.codec(wireSchema, this.schema, { decode, encode })`
  — so `App` = `z.output<this>`, `Wire` = `z.output<wire>`;
- chaining onto an otherwise-unmappable App value (e.g. `s.instanceof(Money)`)
  turns it into a real, storable column. (In drivers that brand unmappable
  fields, this method clears that brand.)

### Relationship to the factory

This mirrors the from-scratch **factory** `s.$<driver>(...)` (which builds a field
given a storage type + codec directly). The two are complementary:

- **factory** `s.$<driver>(...)` — start from nothing, declare both sides.
- **method** `.$<driver>(wire, codec?)` — start from an existing App-typed field,
  attach a storage type + codec.

### SHOULD — type preservation

For the method's `codec` to **infer** `wire`'s type (instead of `unknown`), a
driver's `s.*` **leaf factories SHOULD return precisely-typed fields** (e.g.
`s.varchar(n): PgField<z.ZodString>`), not a widened `Field<ZodType>`. Surreal's
leaves are precisely typed; pg's `mk()` currently widens — a known pg-side
follow-up (tracked in `@schemic/postgres` COVERAGE). The method still works at
runtime when widened; only the static `encode`/`decode` param types degrade.

## Reference implementations

- **SurrealDB** — `.$surreal(wire, codec?)` (`packages/surrealdb/src/pure.ts`).
- **Postgres** — `.$postgres(wire, codec?)` (`packages/postgres/src/authoring.ts`).

```ts
// app value -> stored column, both drivers, same shape:
s.instanceof(Money).$surreal(s.string(), { encode, decode })   // surreal
s.instanceof(Money).$postgres(s.varchar(32), { encode, decode }) // postgres
```

## Rationale

A uniform, predictable "bring your own type" hook across every driver: the name
is the only thing that changes per dialect, so docs/examples/learning transfer
directly. Keeping it a naming + behavior convention (not a base-class method)
preserves `SFieldBase`'s dialect-neutrality and lets each driver type the wire
side in its own vocabulary.
