// Closure-taking `array::*` builtins — `array::filter(tags, |$v| $v > 2)`. The callback receives a
// typed ref for the closure's own `$param`; nested closures get `$v2` so they never shadow the outer
// one. Grammar verified on live 3.1.4 (filter/map/all/any/find take `|$v|`; fold takes an init).

import { describe, expect, test } from "bun:test";
import { defineTable, s } from "../../src/index";
import { select } from "../../src/query";

const T = defineTable("t", {
  tags: s.array(s.string()),
  nums: s.array(s.int()),
});

// Callback types taken off a real builder instance (`typeof select<typeof T>` resolves to the
// schemaless overload, which degrades the row refs to `FieldRef<unknown>`).
const q0 = select(T);
/** The WHERE of a predicate over `T` — the interesting half. */
const whereSql = (f: Parameters<typeof q0.where>[0]) =>
  select(T).where(f).toSQL();
/** The projected VALUE expression. */
const valueSql = (f: Parameters<typeof q0.value>[0]) =>
  select(T).value(f).toSQL().sql;

describe("array closures", () => {
  test("all/any are BOOLEAN, so they drop straight into where()", () => {
    const { sql, vars } = whereSql((r) => r.tags.any((v) => v.eq("x")));
    expect(sql).toBe("SELECT * FROM t WHERE array::any(tags, |$v| $v = $b0)");
    expect(vars).toEqual({ b0: "x" });
    expect(whereSql((r) => r.nums.all((v) => v.gt(0))).sql).toContain(
      "array::all(nums, |$v| $v > $b0)",
    );
  });

  test("filter/map/find lower to their builtin with the closure body", () => {
    expect(valueSql((r) => r.nums.filter((v) => v.gt(2)))).toContain(
      "array::filter(nums, |$v| $v > $b0)",
    );
    expect(valueSql((r) => r.nums.map((v) => v.times(2)))).toContain(
      "array::map(nums, |$v| $v * ",
    );
    expect(valueSql((r) => r.nums.find((v) => v.gt(1)))).toContain(
      "array::find(nums, |$v| $v > $b0)",
    );
  });

  test("the closure param carries the ELEMENT's stdlib family", () => {
    // a string element gets string::*, a number element gets the arithmetic ops
    expect(valueSql((r) => r.tags.map((v) => v.uppercase()))).toContain(
      "array::map(tags, |$v| string::uppercase($v))",
    );
  });

  test("fold seeds the accumulator; $acc carries the SEED's family", () => {
    // A `0` seed must make `.plus()` reachable on `$acc` — the element kind would be wrong here.
    const { sql, vars } = select(T)
      .value((r) => r.nums.fold(0, (acc, v) => acc.plus(v)))
      .toSQL();
    expect(sql).toContain("array::fold(nums, $b0, |$acc, $v| $acc + $v)");
    expect(vars.b0).toBe(0);
    expect(valueSql((r) => r.nums.reduce((acc, v) => acc.plus(v)))).toContain(
      "array::reduce(nums, |$acc, $v| $acc + $v)",
    );
  });

  test("a closure result keeps chaining (it is a ref again)", () => {
    expect(valueSql((r) => r.nums.filter((v) => v.gt(1)).sort())).toContain(
      "array::sort(array::filter(nums, |$v| $v > $b0))",
    );
    // filter preserves the element type, so `.length()` is the array stdlib, not the element's
    expect(
      whereSql((r) =>
        r.nums
          .filter((v) => v.gt(2))
          .length()
          .gt(1),
      ).sql,
    ).toContain("array::len(array::filter(nums, |$v| $v > $b0)) > $b1");
  });

  test("a NESTED closure gets $v2 — it never shadows the outer $v", () => {
    const { sql } = whereSql((r) =>
      r.nums.any((v) => r.tags.any((t) => t.eq("x")).and(v.gt(3))),
    );
    // the inner closure names its param `$v2`, so the outer `$v` stays reachable in the body
    expect(sql).toContain("array::any(tags, |$v2| $v2 = $b0)");
    expect(sql).toContain("$v > $b1");
  });

  test("SIBLING closures both reuse $v (depth, not a global counter)", () => {
    // Two closures at the same nesting depth are independent scopes — reusing `$v` is correct, and
    // it keeps the lowered SQL independent of how many closures were built earlier in the process.
    const { sql } = whereSql((r) =>
      r.nums.any((v) => v.gt(0)).and(r.tags.any((v) => v.eq("x"))),
    );
    expect(sql).toBe(
      "SELECT * FROM t WHERE array::any(nums, |$v| $v > $b0) AND array::any(tags, |$v| $v = $b1)",
    );
  });

  test("identical queries lower to identical SQL, however many were built before", () => {
    const once = whereSql((r) => r.tags.any((v) => v.eq("x"))).sql;
    for (let i = 0; i < 5; i++) whereSql((r) => r.nums.any((v) => v.gt(i)));
    expect(whereSql((r) => r.tags.any((v) => v.eq("x"))).sql).toBe(once);
  });
});
