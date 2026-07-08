// @schemic/surrealdb/query SCHEMALESS: targeting a table not modeled in Schemic — pass a plain
// name string or an SDK `Table`. The data is `Record<string, unknown>` (no codec), callback rows
// are a proxy (any field -> a generic ref), and everything else composes unchanged.

import { describe, expect, test } from "bun:test";
import { RecordId, Table } from "surrealdb";
import {
  create,
  relate,
  remove,
  select,
  update,
  upsert,
} from "../../src/query";

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

describe("schemaless writes — create / update / upsert / remove / relate (untyped)", () => {
  test("create/update/upsert/remove lower like their typed forms (no codec validation)", () => {
    expect(create("user", "u1").content({ name: "A" }).toSQL().sql).toBe(
      "CREATE $__thing CONTENT $__content RETURN AFTER",
    );
    expect(create("user").toSQL().sql).toBe("CREATE user RETURN AFTER"); // contentless ok
    expect(update("user", "u1").merge({ n: 1 }).toSQL().sql).toBe(
      "UPDATE $__thing MERGE $__payload RETURN AFTER",
    );
    expect(upsert("user", "u1").set({ x: 1 }).toSQL().sql).toBe(
      "UPSERT $__thing SET x = $__s0 RETURN AFTER",
    );
    expect(remove("user", "u1").toSQL().sql).toBe(
      "DELETE $__thing RETURN NONE",
    );
  });

  test(".content/.merge/.set take a raw Record<string, unknown> — arbitrary fields pass through", () => {
    const { vars } = create("user", "u1")
      .content({ any: "field", nested: { ok: true } })
      .toSQL();
    expect(vars.__content).toEqual({ any: "field", nested: { ok: true } });
  });

  test("proxy .where callback + the .all() bulk guard both work untyped", () => {
    // Untyped refs carry the base comparison ops (kind-specific stdlib like `.plus` is unknown here
    // and goes through `surql.fn`, matching the builder's existing unknown-kind behavior).
    const { sql, vars } = update("user")
      .all()
      .set({ active: false })
      .where((r) => r.age.lt(18))
      .toSQL();
    expect(sql).toBe(
      "UPDATE user SET active = $__s0 WHERE age < $b1 RETURN AFTER",
    );
    expect(vars.b1).toBe(18);
    // unscoped whole-table write still needs .all()
    expect(() => update("user").set({ x: 1 }).toSQL()).toThrow(
      /rewrite EVERY row/,
    );
  });

  test("relate over an untyped edge — endpoints are records, edge body untyped", () => {
    const { sql } = relate(
      new RecordId("user", "a"),
      "likes",
      new RecordId("post", "p"),
    )
      .set({ rating: 5 })
      .toSQL();
    expect(sql).toBe(
      "RELATE $__from->likes->$__to SET rating = $__s0 RETURN AFTER",
    );
    // an SDK Table edge works too
    expect(
      relate(
        new RecordId("user", "a"),
        new Table("likes"),
        new RecordId("post", "p"),
      ).toSQL().sql,
    ).toBe("RELATE $__from->likes->$__to RETURN AFTER");
  });
});
