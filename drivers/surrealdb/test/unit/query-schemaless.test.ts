// @schemic/surrealdb/query SCHEMALESS: targeting a table not modeled in Schemic — pass a plain
// name string or an SDK `Table`. The data is `Record<string, unknown>` (no codec), callback rows
// are a proxy (any field -> a generic ref), and everything else composes unchanged.

import { describe, expect, test } from "bun:test";
import { RecordId, Table } from "surrealdb";
import { select } from "../../src/query";

// --- type-level: an untyped select is Record<string, unknown> --------------------------------------
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

const q = select("user");
type Res = Awaited<ReturnType<(typeof q)["run"]>>;
type _res = Expect<Equal<Res, Record<string, unknown>[]>>; // untyped rows
const one = select("user", "u1").only();
type OneRes = Awaited<ReturnType<(typeof one)["run"]>>;
type _one = Expect<Equal<OneRes, Record<string, unknown> | undefined>>;

describe("schemaless select — string | Table source", () => {
  test("a plain name lowers to a bare SELECT", () => {
    expect(select("user").toSQL().sql).toBe("SELECT * FROM user");
  });

  test("an SDK Table is accepted too", () => {
    expect(select(new Table("user")).toSQL().sql).toBe("SELECT * FROM user");
  });

  test("callback rows are a proxy — any field resolves to a generic ref", () => {
    const { sql, vars } = select("user")
      .where((r) => r.age.gt(18))
      .orderBy((r) => r.name)
      .toSQL();
    expect(sql).toBe("SELECT * FROM user WHERE age > $b0 ORDER BY name ASC");
    expect(vars.b0).toBe(18);
  });

  test("a projection over arbitrary fields works (aliased)", () => {
    expect(
      select("user")
        .return((r) => ({ n: r.name, a: r.age }))
        .toSQL().sql,
    ).toBe("SELECT name AS n, age AS a FROM user");
  });

  test("targeting a record by id -> FROM $__thing", () => {
    const { sql, vars } = select("user", "alice").toSQL();
    expect(sql).toBe("SELECT * FROM $__thing");
    expect(String(vars.__thing)).toBe("user:alice");
  });

  test("a RecordId id is used as-is", () => {
    const { vars } = select("user", new RecordId("user", "x")).toSQL();
    expect(String(vars.__thing)).toBe("user:x");
  });
});
