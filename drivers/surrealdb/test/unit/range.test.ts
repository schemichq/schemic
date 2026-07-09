// SurrealQL RANGES (`1..=10`) as a first-class VALUE: the `range()` builder's bound spelling, its
// lowering (bounds BIND as params), and its uses — `IN` membership and `FOR` iteration.
// Grammar verified on live 3.1.4: `>` after the start excludes it, `=` before the end includes it.

import { describe, expect, test } from "bun:test";
import { defineTable, isRange, Range, range, s, surql } from "../../src/index";
import { block, select } from "../../src/query";

const Person = defineTable("person", { age: s.int(), name: s.string() });

/** The lowered `WHERE` of a range predicate — the interesting half. */
const whereOf = (r: ReturnType<typeof range<number>>) =>
  select(Person)
    .where((p) => p.age.in(r))
    .toSQL();

describe("range() — bound spelling", () => {
  test("from/to INCLUDE their bound; after/until EXCLUDE it", () => {
    // The four combinations SurrealQL spells `a..b` / `a..=b` / `a>..b` / `a>..=b`.
    expect(whereOf(range({ from: 1, to: 10 })).sql).toContain("IN $b0..=$b1");
    expect(whereOf(range({ from: 1, until: 10 })).sql).toContain("IN $b0..$b1");
    expect(whereOf(range({ after: 0, to: 10 })).sql).toContain("IN $b0>..=$b1");
    expect(whereOf(range({ after: 0, until: 11 })).sql).toContain(
      "IN $b0>..$b1",
    );
  });

  test("either end may be OPEN", () => {
    expect(whereOf(range({ from: 18 })).sql).toContain("IN $b0..");
    expect(whereOf(range({ to: 65 })).sql).toContain("IN ..=$b0");
    expect(whereOf(range({ until: 65 })).sql).toContain("IN ..$b0");
  });

  test("bounds BIND as params (they are values, not SQL text)", () => {
    const { sql, vars } = whereOf(range({ from: 18, to: 65 }));
    expect(sql).toBe("SELECT * FROM person WHERE age IN $b0..=$b1");
    expect(vars).toEqual({ b0: 18, b1: 65 });
  });

  test("mixing the two spellings of one end is a runtime error too (untyped callers)", () => {
    expect(() => range({ from: 1, after: 2 } as never)).toThrow(
      /`from` \(start included\) OR `after` \(start excluded\)/,
    );
    expect(() => range({ to: 1, until: 2 } as never)).toThrow(
      /`to` \(end included\) OR `until` \(end excluded\)/,
    );
  });

  test("a range with NO bound is meaningless", () => {
    expect(() => range({} as never)).toThrow(/needs at least one bound/);
  });

  test("isRange() brands cross-realm; range() builds a Range", () => {
    expect(isRange(range({ from: 1, to: 2 }))).toBe(true);
    expect(range({ from: 1, to: 2 })).toBeInstanceOf(Range);
    expect(isRange(42)).toBe(false);
    expect(isRange([1, 2])).toBe(false);
    expect(isRange(null)).toBe(false);
  });
});

describe("range() — uses", () => {
  test("IN / NOT IN test membership, alongside the list form", () => {
    expect(
      select(Person)
        .where((p) => p.age.notIn(range({ from: 18, to: 65 })))
        .toSQL().sql,
    ).toBe("SELECT * FROM person WHERE age NOT IN $b0..=$b1");
    // the list form is untouched
    expect(
      select(Person)
        .where((p) => p.age.in([1, 2]))
        .toSQL().sql,
    ).toBe("SELECT * FROM person WHERE age IN $b0");
  });

  test("string bounds range over strings ('g' IN 'a'..'z')", () => {
    const { sql, vars } = select(Person)
      .where((p) => p.name.in(range({ from: "a", until: "z" })))
      .toSQL();
    expect(sql).toBe("SELECT * FROM person WHERE name IN $b0..$b1");
    expect(vars).toEqual({ b0: "a", b1: "z" });
  });

  test("FOR iterates a range; the loop var carries the bound's type", () => {
    const { query } = block()
      .for(
        { y: range({ from: 2020, to: 2022 }) },
        () => surql`CREATE ev SET year = $y`,
      )
      .toQuery();
    expect(query).toMatch(
      /FOR \$y IN \$\w+\.\.=\$\w+ \{ CREATE ev SET year = \$y \}/,
    );
  });

  test("a range DENOTES its span, so the loop var is number (not the literal bounds)", () => {
    // Guards the `const T` trap: `Range<2020 | 2022>` would type `$y` as `2020 | 2022` and
    // silently omit 2021 — the loop really does yield it.
    block().for({ y: range({ from: 2020, to: 2022 }) }, (v) => {
      const _numeric: unknown = v.y.gt(2020); // number stdlib is reachable
      void _numeric;
      return surql`RETURN 1`;
    });
    expect(true).toBe(true);
  });
});
