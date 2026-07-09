// @schemic/postgres/query — the pg-owned single-table builder on the @schemic/core/query toolkit.
// Proves: (a) SQL + positional params lowering, (b) decode-by-default → real App types (incl. a
// transforming codec field), (c) .return(...) re-types to the projected decoded shape (type-level).

import { describe, expect, test } from "bun:test";
import { defineTable, pgSql, s } from "../src";
import type { App } from "../src/authoring";
import { and, not, or, type SelectQuery, select } from "../src/query";

// A table with a numeric field (for comparisons), a Date field (timestamptz), and a TRANSFORMING codec
// field via `$postgres` (wire text stored lowercase, app string read uppercase) — to prove decode runs.
const user = defineTable("user", {
  name: s.text(),
  age: s.integer(),
  createdAt: s.timestamptz(),
  slug: s.text().$postgres(s.text(), {
    encode: (app: string) => app.toLowerCase(),
    decode: (wire) => String(wire).toUpperCase(),
  }),
});

// --- type-level: .return re-types via core Project --------------------------------------------
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;
type ResOf<Q> = Q extends SelectQuery<infer _TD, infer R> ? R : never;

// an implicit-id table carries its id on the returned row: `App & { id: string }` (RowOf)
type _bare = Expect<
  Equal<
    ResOf<ReturnType<typeof select<typeof user>>>,
    App<typeof user> & { id: string }
  >
>;
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
      'SELECT "id", "name", "age", "createdAt", "slug" FROM "user" WHERE "age" >= $1 ORDER BY "name" DESC LIMIT $2;',
    );
    expect(params).toEqual([18, 5]);
  });

  test("a pgSql fragment is a typed OPERAND — spliced (parens), not bound", () => {
    // the headline: `u.age.gte(pgSql`24`)` — raw SQL as a comparison operand
    expect(
      select(user)
        .where((r) => r.age.gte(pgSql`24`))
        .toSQL(),
    ).toEqual({
      sql: 'SELECT "id", "name", "age", "createdAt", "slug" FROM "user" WHERE "age" >= (24);',
      params: [],
    });
    // a fragment carrying its OWN bind renumbers + merges alongside other params
    const { sql, params } = select(user)
      .where((r) => and(r.name.eq("x"), r.age.gt(pgSql`${20} + 4`)))
      .toSQL();
    expect(sql).toBe(
      'SELECT "id", "name", "age", "createdAt", "slug" FROM "user" WHERE ("name" = $1 AND "age" > ($2 + 4));',
    );
    expect(params).toEqual(["x", 20]);
    // works inside IN too
    expect(
      select(user)
        .where((r) => r.age.in([pgSql`24`, 30]))
        .toSQL().sql,
    ).toContain('"age" IN ((24), $1)');
  });

  test("a raw pgSql PREDICATE in where — column refs splice as identifiers", () => {
    // `where(u => pgSql`${u.age} > 24`)` — the ref splices as "age", the literal is inline
    expect(
      select(user)
        .where((r) => pgSql`${r.age} > 24`)
        .toSQL(),
    ).toEqual({
      sql: 'SELECT "id", "name", "age", "createdAt", "slug" FROM "user" WHERE ("age" > 24);',
      params: [],
    });
    // a ref splices while an interpolated VALUE still binds
    expect(
      select(user)
        .where((r) => pgSql`${r.age} > ${24}`)
        .toSQL(),
    ).toEqual({
      sql: 'SELECT "id", "name", "age", "createdAt", "slug" FROM "user" WHERE ("age" > $1);',
      params: [24],
    });
  });

  test("Expr.and/.or/.not chain, and raw predicates mix into them", () => {
    const { sql, params } = select(user)
      .where((r) => r.age.gte(18).and(pgSql`${r.name} <> 'x'`).not())
      .toSQL();
    expect(sql).toContain(`WHERE NOT (("age" >= $1 AND ("name" <> 'x')))`);
    expect(params).toEqual([18]);
    // free-function not(), and .or() taking a raw fragment
    expect(
      select(user)
        .where((r) => not(r.age.gte(25)))
        .toSQL().sql,
    ).toContain('WHERE NOT ("age" >= $1)');
    expect(
      select(user)
        .where((r) => r.age.lt(20).or(pgSql`${r.name} = 'x'`))
        .toSQL().sql,
    ).toContain(`WHERE ("age" < $1 OR ("name" = 'x'))`);
  });

  test("and/or compose", () => {
    const { sql, params } = select(user)
      .where((r) => and(r.age.gte(18), or(r.name.eq("a"), r.name.eq("b"))))
      .toSQL();
    expect(sql).toBe(
      'SELECT "id", "name", "age", "createdAt", "slug" FROM "user" WHERE ("age" >= $1 AND ("name" = $2 OR "name" = $3));',
    );
    expect(params).toEqual([18, "a", "b"]);
  });

  test("projection → SELECT col AS alias", () => {
    const { sql, params } = select(user)
      .return((r) => ({ n: r.name, when: r.createdAt }))
      .toSQL();
    expect(sql).toBe(
      'SELECT "name" AS "n", "createdAt" AS "when" FROM "user";',
    );
    expect(params).toEqual([]);
  });
});

// A table with string / int / array / nullable columns — to exercise the Phase-1 typed-narrowed ops.
const p1 = defineTable("p1", {
  id: s.text().$primaryKey(),
  title: s.text(),
  views: s.integer(),
  tags: s.array(s.text()),
  note: s.text().nullable(),
});

describe("postgres/query — Phase 1 ops (SQL lowering)", () => {
  test("in / notIn → IN (…) / NOT IN (…); empty set → FALSE / TRUE", () => {
    expect(
      select(p1)
        .where((r) => r.id.in(["a", "b"]))
        .toSQL().sql,
    ).toContain('"id" IN ($1, $2)');
    expect(
      select(p1)
        .where((r) => r.id.notIn(["a"]))
        .toSQL().sql,
    ).toContain('"id" NOT IN ($1)');
    expect(
      select(p1)
        .where((r) => r.id.in([]))
        .toSQL().sql,
    ).toContain("WHERE FALSE");
    expect(
      select(p1)
        .where((r) => r.id.notIn([]))
        .toSQL().sql,
    ).toContain("WHERE TRUE");
  });

  test("isNone / isNotNone → IS NULL / IS NOT NULL (no bind)", () => {
    const a = select(p1)
      .where((r) => r.note.isNone())
      .toSQL();
    expect(a.sql).toContain('"note" IS NULL');
    expect(a.params).toEqual([]);
    expect(
      select(p1)
        .where((r) => r.note.isNotNone())
        .toSQL().sql,
    ).toContain('"note" IS NOT NULL');
  });

  test("startsWith → starts_with(); endsWith → right(col, char_length($1)) = $1 (single bind)", () => {
    expect(
      select(p1)
        .where((r) => r.title.startsWith("al"))
        .toSQL(),
    ).toEqual({
      sql: 'SELECT "id", "title", "views", "tags", "note" FROM "p1" WHERE starts_with("title", $1);',
      params: ["al"],
    });
    expect(
      select(p1)
        .where((r) => r.title.endsWith("ma"))
        .toSQL(),
    ).toEqual({
      sql: 'SELECT "id", "title", "views", "tags", "note" FROM "p1" WHERE right("title", char_length($1)) = $1;',
      params: ["ma"],
    });
  });

  test("includes → strpos(col, $1) > 0 (ratified cross-driver substring op)", () => {
    expect(
      select(p1)
        .where((r) => r.title.includes("ell"))
        .toSQL(),
    ).toEqual({
      sql: 'SELECT "id", "title", "views", "tags", "note" FROM "p1" WHERE strpos("title", $1) > 0;',
      params: ["ell"],
    });
  });

  test("contains → = ANY; containsAny → &&; containsAll → @> (array bound whole)", () => {
    expect(
      select(p1)
        .where((r) => r.tags.contains("y"))
        .toSQL(),
    ).toEqual({
      sql: 'SELECT "id", "title", "views", "tags", "note" FROM "p1" WHERE $1 = ANY("tags");',
      params: ["y"],
    });
    expect(
      select(p1)
        .where((r) => r.tags.containsAny(["x", "z"]))
        .toSQL().sql,
    ).toContain('"tags" && $1');
    expect(
      select(p1)
        .where((r) => r.tags.containsAll(["x", "y"]))
        .toSQL().sql,
    ).toContain('"tags" @> $1');
  });

  test("start → OFFSET (after LIMIT)", () => {
    const { sql, params } = select(p1).limit(5).start(10).toSQL();
    expect(sql).toContain("LIMIT $1 OFFSET $2");
    expect(params).toEqual([5, 10]);
  });

  test(".count() → SELECT count(*) with WHERE only", () => {
    const { sql } = select(p1)
      .where((r) => r.views.gt(3))
      .count()
      .toSQL();
    expect(sql).toBe(
      'SELECT count(*)::int AS count FROM "p1" WHERE "views" > $1;',
    );
  });

  test(".one() forces LIMIT 1", () => {
    expect(
      select(p1)
        .where((r) => r.id.eq("x"))
        .one()
        .toSQL().sql,
    ).toContain("LIMIT $");
  });
});

describe("postgres/query — Phase 1 typed narrowing (compile-time)", () => {
  test("op sets narrow by column type", () => {
    // string ops only on string columns
    select(p1).where((r) => r.title.startsWith("a"));
    select(p1).where((r) => r.title.endsWith("a"));
    select(p1).where((r) => r.title.includes("a"));
    // @ts-expect-error — startsWith is string-only (views is an int column)
    select(p1).where((r) => r.views.startsWith("a"));
    // @ts-expect-error — includes is string-only (views is an int column)
    select(p1).where((r) => r.views.includes("a"));
    // contains* only on array columns
    select(p1).where((r) => r.tags.contains("x"));
    select(p1).where((r) => r.tags.containsAll(["x"]));
    // @ts-expect-error — contains is array-only (title is a string column)
    select(p1).where((r) => r.title.contains("x"));
    // @ts-expect-error — arrays don't get string ops
    select(p1).where((r) => r.tags.startsWith("x"));
    // in / isNone are on EVERY column
    select(p1).where((r) => r.views.in([1, 2]));
    select(p1).where((r) => r.note.isNone());
    expect(true).toBe(true);
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
