/** Escape hatch: store an otherwise-unmappable App value via a pg type + Zod codec. */
import * as z from "zod";
import { defineTable, PgField, s } from "../../src/authoring";
import type { ExampleGroup } from "./_kit";

class Money {
  constructor(public cents: number) {}
}

export const group: ExampleGroup = {
  file: "07-escape-hatch.ts",
  about:
    "Escape hatch — s.$postgres(pgType, codec) factory + chainable .$postgres(wire, codec?)",
  examples: [
    {
      title: "factory: s.$postgres(pgType, codec) (from scratch)",
      defs: [defineTable("blob", { raw: s.$postgres("text", z.string()) })],
      ddl: `CREATE TABLE "blob" (
  "id" text PRIMARY KEY,
  "raw" text NOT NULL
);`,
    },
    {
      title:
        "chainable: App value -> stored as the wire type (mirrors surreal .$surreal)",
      note: "column emits as the wire type (varchar(32)); the codec maps app<->wire",
      defs: [
        defineTable("tx", {
          amount: new PgField(z.instanceof(Money), {}).$postgres(
            s.varchar(32),
            {
              encode: (m: Money) => String(m.cents),
              decode: (v) => new Money(Number(v as string)),
            },
          ),
        }),
      ],
      ddl: `CREATE TABLE "tx" (
  "id" text PRIMARY KEY,
  "amount" varchar(32) NOT NULL
);`,
    },
  ],
};
