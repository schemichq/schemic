// @schemic/postgres/query — the pg-owned single-table builder on the @schemic/core/query toolkit.
// Proves: (a) SQL + positional params lowering, (b) decode-by-default → real App types (incl. a
// transforming codec field), (c) .return(...) re-types to the projected decoded shape (type-level).

import { describe, expect, test } from "bun:test";
import { defineTable, s } from "../src";
import type { App } from "../src/authoring";
import { and, or, SelectQuery, select } from "../src/query";

// A table with a numeric field (for comparisons), a Date field (timestamptz), and a TRANSFORMING codec
// field via `$postgres` (wire text stored lowercase, app string read uppercase) — to prove decode runs.
const user = defineTable("user", {
  name: s.text(),
  age: s.integer(),
  createdAt: s.timestamptz(),
  slug: s
    .text()
    .$postgres(s.text(), {
      encode: (app: string) => app.toLowerCase(),
      decode: (wire) => String(wire).toUpperCase(),
    }),
});

// --- type-level: .return re-types via core Project --------------------------------------------
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;
type ResOf<Q> = Q extends SelectQuery<infer _TD, infer R> ? R : never;

type _bare = Expect<Equal<ResOf<ReturnType<typeof select<typeof user>>>, App<typeof user>>>;
const _proj = select(user).return((r) => ({ n: r.name, when: r.createdAt }));
type _projRes = Expect<Equal<ResOf<typeof _proj>, { n: string; when: Date }>>;

describe("postgres/query — SQL lowering", () => {
  test("where + orderBy + limit → positional binds", () => {
    const { sql, params } = select(user)
      .where((r) => r.age.gte(18))
      .orderBy((r) => r.name, "desc")
      .limit(5)
      .toSQL();
    expect(sql).toBe(
      'SELECT "name", "age", "createdAt", "slug" FROM "user" WHERE "age" >= $1 ORDER BY "name" DESC LIMIT $2;',
    );
    expect(params).toEqual([18, 5]);
  });

  test("and/or compose", () => {
    const { sql, params } = select(user)
      .where((r) => and(r.age.gte(18), or(r.name.eq("a"), r.name.eq("b"))))
      .toSQL();
    expect(sql).toBe(
      'SELECT "name", "age", "createdAt", "slug" FROM "user" WHERE ("age" >= $1 AND ("name" = $2 OR "name" = $3));',
    );
    expect(params).toEqual([18, "a", "b"]);
  });

  test("projection → SELECT col AS alias", () => {
    const { sql, params } = select(user)
      .return((r) => ({ n: r.name, when: r.createdAt }))
      .toSQL();
    expect(sql).toBe('SELECT "name" AS "n", "createdAt" AS "when" FROM "user";');
    expect(params).toEqual([]);
  });
});

describe("postgres/query — decode", () => {
  const when = new Date("2020-05-06T07:08:09.000Z");
  const rawRows = [{ name: "Ada", age: 36, createdAt: when, slug: "ada-l" }];

  test("decode-by-default returns App types (Date + transformed codec field)", () => {
    const [row] = select(user).decode(rawRows);
    expect(row.name).toBe("Ada");
    expect(row.age).toBe(36);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.slug).toBe("ADA-L"); // codec decode transformed wire "ada-l" -> "ADA-L"
  });

  test("projection decodes through the ad-hoc codec", () => {
    // A projected query returns ALIAS-keyed columns (SQL `... AS who`), so decode keys by the alias.
    const [row] = select(user)
      .return((r) => ({ who: r.name, when: r.createdAt }))
      .decode([{ who: "Ada", when }]);
    expect(row.who).toBe("Ada");
    expect(row.when).toBeInstanceOf(Date);
    // @ts-expect-error — projected shape has no `age`
    expect(row.age).toBeUndefined();
  });

  test(".raw() skips decode (wire passthrough)", () => {
    const [row] = select(user).raw().decode(rawRows);
    expect(row.slug).toBe("ada-l"); // NOT uppercased — decode skipped
  });
});
