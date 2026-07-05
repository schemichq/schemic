// Typed-fragments PHASE 3 (1/3): the per-kind stdlib on field refs — `u.name.length()` lowers
// to `string::len(name)` and CHAINS (the result is a ref again, with the right next family).
// Numbers get math/arithmetic, arrays get array::*, datetimes get time::*; a ref whose runtime
// kind is unknown throws with guidance instead of a bare "not a function".
import { describe, expect, test } from "bun:test";
import { defineTable, s, surql } from "../../src/index";
import { select } from "../../src/query";

const User = defineTable("rm_user", {
  name: s.string(),
  age: s.number(),
  tags: s.array(s.string()),
  scores: s.array(s.number()),
  joined: s.datetime(),
});

describe("string methods", () => {
  test("length() chains into comparisons: string::len(name) > $b0", () => {
    const { sql, vars } = select(User)
      .where((u) => u.name.length().gt(3))
      .toSQL();
    expect(sql).toBe("SELECT * FROM rm_user WHERE string::len(name) > $b0");
    expect(vars).toEqual({ b0: 3 });
  });

  test("derived-of-derived: lowercase().startsWith('a')", () => {
    const { sql } = select(User)
      .where((u) => u.name.lowercase().startsWith("a"))
      .toSQL();
    expect(sql).toBe(
      "SELECT * FROM rm_user WHERE string::starts_with(string::lowercase(name), $b0)",
    );
  });

  test("methods with args bind them: replace/slice/repeat", () => {
    const { sql, vars } = select(User)
      .where((u) => u.name.replace("a", "b").eq("x"))
      .toSQL();
    expect(sql).toMatch(
      /WHERE string::replace\(name, \$r\d+, \$r\d+\) = \$b\d+$/,
    );
    expect(Object.values(vars)).toEqual(
      expect.arrayContaining(["a", "b", "x"]),
    );
  });

  test("split() returns an array ref — array family chains on", () => {
    const { sql } = select(User)
      .where((u) => u.name.split(" ").length().gte(2))
      .toSQL();
    expect(sql).toMatch(
      /WHERE array::len\(string::split\(name, \$r\d+\)\) >= \$b\d+$/,
    );
  });
});

describe("number methods", () => {
  test("arithmetic operators parenthesize: (age + $r) >= $b0", () => {
    const { sql } = select(User)
      .where((u) => u.age.plus(1).gte(18))
      .toSQL();
    expect(sql).toMatch(/WHERE age \+ \$r\d+ >= \$b\d+$/);
  });

  test("math:: fns wrap and chain: math::floor(math::abs(age))", () => {
    const { sql } = select(User)
      .where((u) => u.age.abs().floor().lt(100))
      .toSQL();
    expect(sql).toBe(
      "SELECT * FROM rm_user WHERE math::floor(math::abs(age)) < $b0",
    );
  });
});

describe("array methods", () => {
  test("length()/join(): array::len(tags), array::join(tags, sep)", () => {
    const { sql } = select(User)
      .where((u) => u.tags.length().gt(0))
      .toSQL();
    expect(sql).toBe("SELECT * FROM rm_user WHERE array::len(tags) > $b0");
  });

  test("element kind flows: tags.first() is a STRING ref (string family chains)", () => {
    const { sql } = select(User)
      .where((u) => u.tags.first().length().gt(2))
      .toSQL();
    expect(sql).toBe(
      "SELECT * FROM rm_user WHERE string::len(array::first(tags)) > $b0",
    );
  });

  test("numeric element kind: scores.at(0).plus(1)", () => {
    const { sql } = select(User)
      .where((u) => u.scores.at(0).plus(1).gte(10))
      .toSQL();
    expect(sql).toMatch(
      /WHERE array::at\(scores, \$r\d+\) \+ \$r\d+ >= \$b\d+$/,
    );
  });
});

describe("datetime methods", () => {
  test("time:: parts are number refs: time::year(joined) = $b0", () => {
    const { sql } = select(User)
      .where((u) => u.joined.year().eq(2026))
      .toSQL();
    expect(sql).toBe("SELECT * FROM rm_user WHERE time::year(joined) = $b0");
  });
});

describe("interpolation + operands", () => {
  test("a derived ref splices into a surql template as its rendered expression", () => {
    const q = surql`RETURN ${select(User).where((u) => u.name.length().gt(3))}`;
    expect(q.query).toMatch(
      /RETURN \(SELECT \* FROM rm_user WHERE string::len\(name\) > \$sub__\d+_b0\)/,
    );
  });

  test("a derived ref works as an OPERAND: age >= string::len(name)", () => {
    const { sql } = select(User)
      .where((u) => u.age.gte(u.name.length()))
      .toSQL();
    expect(sql).toBe("SELECT * FROM rm_user WHERE age >= string::len(name)");
  });

  test("projection: a derived expression projects with AS + identity decode", () => {
    const q = select(User).return((u) => ({
      name: u.name,
      nameLen: u.name.length(),
    }));
    expect(q.toSQL().sql).toBe(
      "SELECT name, string::len(name) AS nameLen FROM rm_user",
    );
    const rows = q.decodeRows([{ name: "ada", nameLen: 3 }]);
    expect(rows).toEqual([{ name: "ada", nameLen: 3 }]);
  });
});

describe("typing + guards", () => {
  test("typed: string methods are rejected on number columns", () => {
    const _bad = () =>
      // @ts-expect-error — .lowercase() is a string method; age is a number
      select(User).where((u) => u.age.lowercase().eq("x"));
    expect(typeof _bad).toBe("function");
  });

  test("orderBy rejects a derived expression with guidance", () => {
    expect(() =>
      select(User)
        // the runtime error is the contract; the type surface allows FieldRefOps
        .orderBy((u) => u.name.length())
        .toSQL(),
    ).toThrow(/plain column ref/);
  });

  test("unknown-kind refs throw with guidance instead of 'not a function'", async () => {
    const { block } = await import("../../src/query");
    expect(() =>
      block()
        .let("x", surql`$something`)
        .return((sv) => (sv.x as unknown as { length(): unknown }).length()),
    ).toThrow(/surql\.fn/);
  });
});

// --- live (SURREAL_URL-gated) ---------------------------------------------------------------------
const URL = process.env.SURREAL_URL;

describe.skipIf(!URL)("ref-methods live", () => {
  test("derived predicates + projections run end to end", async () => {
    const { Surreal } = await import("surrealdb");
    const { emitTable } = await import("../../src/ddl");

    const c = new Surreal();
    await c.connect(URL as string);
    await c.signin({ username: "root", password: "root" });
    await c.use({ namespace: "rm", database: "rm" });
    await c.query("REMOVE TABLE IF EXISTS rm_user;");
    await c.query(emitTable(User, { exists: "overwrite" }));
    await c.query(
      "CREATE rm_user:1 SET name = 'ada lovelace', age = 36, tags = ['math', 'pioneer'], scores = [9, 8], joined = d'2026-01-02T03:04:05Z';" +
        "CREATE rm_user:2 SET name = 'kid', age = 9, tags = [], scores = [1], joined = d'2020-06-01T00:00:00Z';",
    );

    const longNames = await select(User)
      .where((u) => u.name.length().gt(5))
      .run(c);
    expect(longNames.map((u) => u.name)).toEqual(["ada lovelace"]);

    const proj = await select(User)
      .where((u) => u.tags.length().gt(0))
      .return((u) => ({
        upper: u.name.uppercase(),
        nTags: u.tags.length(),
        year: u.joined.year(),
        bumped: u.age.plus(1),
      }))
      .run(c);
    expect(proj).toEqual([
      { upper: "ADA LOVELACE", nTags: 2, year: 2026, bumped: 37 },
    ]);

    await c.query("REMOVE TABLE IF EXISTS rm_user;");
    await c.close();
  }, 60_000);
});
