/**
 * Escape hatches — app-only types and DB-managed fields.
 *
 * App-only types (s.custom / s.instanceof / s.symbol / ...) have NO SurrealQL mapping and are rejected
 * at `defineTable` unless given a wire type + codec via `.$surreal(wire, codec?)` (the standard
 * chainable escape hatch — see packages/core/docs/ESCAPE-HATCH-CONVENTION.md). `.$internal()` keeps a
 * field DB-managed and hidden from the public surface (PERMISSIONS NONE).
 */
import { type ExampleGroup, ex } from "./_kit";

/** A domain type with no wire representation of its own — referenced by the snippets below (via `scope`). */
class Money {
  constructor(readonly cents: number) {}
  toString() {
    return (this.cents / 100).toFixed(2);
  }
}

const examples = [
  ex({
    title: ".$surreal(wire, codec) — store an instanceof type as a string",
    note: "App type = Money, wire/DDL type = string; the codec maps both ways. Clears the no-DDL brand.",
    scope: { Money },
    code: `defineTable("wallet", {
  id: s.string(),
  price: s.instanceof(Money).$surreal(s.string(), {
    encode: (m) => m.toString(),
    decode: (v) => new Money(Math.round(Number(v) * 100)),
  }),
})`,
    ddl: `DEFINE TABLE wallet TYPE NORMAL SCHEMAFULL;
DEFINE FIELD price ON TABLE wallet TYPE string;`,
  }),
  ex({
    title: ".$surreal on s.custom — store an app-only type (URL) as a string",
    note: "URL has no native SurrealQL type, so it needs a wire type + codec. (A JS Set, by contrast, is native: use s.set() -> set<T>.)",
    code: `defineTable("site", {
  id: s.string(),
  homepage: s.custom<URL>().$surreal(s.string(), {
    encode: (u) => u.href,
    decode: (v) => new URL(v),
  }),
})`,
    ddl: `DEFINE TABLE site TYPE NORMAL SCHEMAFULL;
DEFINE FIELD homepage ON TABLE site TYPE string;`,
  }),
  ex({
    title: ".$internal() — DB-managed, client-hidden field (PERMISSIONS NONE)",
    code: `defineTable("account", { id: s.string(), passhash: s.string().$internal() })`,
    ddl: `DEFINE TABLE account TYPE NORMAL SCHEMAFULL;
DEFINE FIELD passhash ON TABLE account TYPE string PERMISSIONS NONE;`,
  }),
];

export const group: ExampleGroup = {
  file: "09-escape-hatch.ts",
  about:
    "Escape hatches — .$surreal(wire, codec) for app-only types, .$internal() for DB-managed fields",
  examples,
};
