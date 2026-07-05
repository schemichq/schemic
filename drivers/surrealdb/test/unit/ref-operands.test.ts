// REF OPERANDS (Manuel's dogfood catch): builder operands accept typed $param refs from
// contextual callbacks — u.age.gte(a.adultThreshold) splices `age >= $adultThreshold` — plus
// surql fragments; ParamRef<T> carries the value type so mismatches are compile errors.
import { setDefaultTimeout } from "bun:test";

setDefaultTimeout(120_000);

import { describe, expect, test } from "bun:test";
import { defineFunction, defineTable, s, surql } from "../../src/index";
import { select } from "../../src/query";

const User = defineTable("ro_user", {
  name: s.string(),
  age: s.int(),
});

// Manuel's exact repro — a builder inside a function body using a TYPED arg ref as an operand:
const CountAdults = defineFunction("ro_count_adults", {
  adultThreshold: s.number(),
})
  .returns(s.number())
  .body(
    ({ adultThreshold }) => surql`
    LET $adults = ${select(User).where((u) => u.age.gte(adultThreshold))};
    RETURN array::len($adults);
  `,
  );

describe("ref operands", () => {
  test("a typed arg ref splices as $<name> inside the builder (no bind)", () => {
    const { ddl } = (() => {
      const { emitDefStatement } = require("../../src/ddl");
      return emitDefStatement(CountAdults);
    })();
    expect(ddl).toContain("age >= $adultThreshold");
    expect(ddl).toContain("RETURN array::len($adults)");
  });

  test("literals still bind; fragments splice", () => {
    const lit = select(User)
      .where((u) => u.age.gte(18))
      .toSQL();
    expect(lit.sql).toContain("age >= $b0");
    expect(lit.vars.b0).toBe(18);

    const frag = select(User)
      .where((u) => u.age.gte(surql`math::max([18, 21])`))
      .toSQL();
    expect(frag.sql).toContain("age >= (math::max([18, 21]))");
  });

  test("typed: a mismatched ref type is a compile error", () => {
    const _bad = () =>
      defineFunction("x", { label: s.string() }).body(
        // @ts-expect-error — label is a string ref; age is an int column
        ({ label }) => surql`${select(User).where((u) => u.age.gte(label))}`,
      );
    expect(typeof _bad).toBe("function");
  });

  test("event-row refs are typed operands too", () => {
    const T = User.event("ro_evt", {
      then: (e) => surql`${select(User).where((u) => u.age.gte(e.after.age))}`,
    });
    const { emitTable } = require("../../src/ddl");
    const ddl = emitTable(T)
      .split("\n")
      .find((l: string) => l.includes("EVENT"));
    expect(ddl).toContain("age >= $after.age");
  });
});

const URL = process.env.SURREAL_URL;
describe.skipIf(!URL)("ref operands — live", () => {
  test("CountAdults runs end to end via db.call", async () => {
    const { Surreal } = await import("surrealdb");
    const { emitDefStatement, emitTable } = await import("../../src/ddl");
    const { connect } = await import("../../src/client");

    const c = new Surreal();
    await c.connect(URL as string);
    await c.signin({ username: "root", password: "root" });
    await c.use({ namespace: "ro", database: "ro" });
    await c.query(
      "REMOVE TABLE IF EXISTS ro_user; REMOVE FUNCTION IF EXISTS fn::ro_count_adults;",
    );
    await c.query(emitTable(User, { exists: "overwrite" }));
    await c.query(emitDefStatement(CountAdults, { exists: "overwrite" }).ddl);
    await c.query(
      "CREATE ro_user:1 SET name = 'ada', age = 36; CREATE ro_user:2 SET name = 'kid', age = 9;",
    );
    const db = connect(c);
    expect(await db.call(CountAdults, { adultThreshold: 18 })).toBe(1);
    expect(await db.call(CountAdults, { adultThreshold: 5 })).toBe(2);
    await c.query(
      "REMOVE TABLE IF EXISTS ro_user; REMOVE FUNCTION IF EXISTS fn::ro_count_adults;",
    );
    await c.close();
  });
});
