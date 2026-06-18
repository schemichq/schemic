/**
 * Escape hatch: store an otherwise-unmappable App value via a pg type + Zod codec.
 *
 * The `code` snippets are evaluated by the reference test with the pg authoring surface plus `z` and a
 * demo `Money` class in scope (see _kit `evalDefs`), so they are written as plain JS (no TS type
 * annotations) while still showing the real authoring shape.
 */
import { type ExampleGroup, example } from "./_kit";

export const group: ExampleGroup = {
  file: "07-escape-hatch.ts",
  about:
    "Escape hatch — s.$postgres(pgType, codec) factory + chainable .$postgres(wire, codec?)",
  examples: [
    example({
      title: "factory: s.$postgres(pgType, codec) (from scratch)",
      code: `defineTable("blob", { raw: s.$postgres("text", z.string()) })`,
      ddl: `CREATE TABLE "blob" (
  "id" text PRIMARY KEY,
  "raw" text NOT NULL
);`,
    }),
    example({
      title:
        "chainable: App value -> stored as the wire type (mirrors surreal .$surreal)",
      note: "column emits as the wire type (varchar(32)); the codec maps app<->wire. `Money` is a demo App class",
      code: `defineTable("tx", {
  amount: new PgField(z.instanceof(Money), {}).$postgres(s.varchar(32), {
    encode: (m) => String(m.cents),
    decode: (v) => new Money(Number(v)),
  }),
})`,
      ddl: `CREATE TABLE "tx" (
  "id" text PRIMARY KEY,
  "amount" varchar(32) NOT NULL
);`,
    }),
  ],
};
