// @schemic/surrealdb/query Phase-1 READS: the richer WHERE operators (in/notIn, contains*,
// startsWith/endsWith, NONE checks), START pagination, and the terminals one()/get()/count().
// Lowering + type narrowing unit-tested; a live block (SURREAL_URL-gated) verifies semantics.

import { describe, expect, test } from "bun:test";
import { escapeIdent, RecordId, Surreal } from "surrealdb";
import { defineTable, s } from "../../src/index";
import type { App } from "../../src/pure";
import { and, get, select } from "../../src/query";

const Post = defineTable("p1_post", {
  title: s.string(),
  tags: s.array(s.string()),
  views: s.int(),
  nick: s.string().optional(),
});

// --- type-level assertions -----------------------------------------------------------------------
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

const oneQ = select(Post)
  .where((p) => p.title.eq("x"))
  .one();
type OneRes = Awaited<ReturnType<(typeof oneQ)["run"]>>;
type _one = Expect<Equal<OneRes, App<typeof Post> | undefined>>; // one() -> row | undefined

const getQ = get(Post, "a");
type GetRes = Awaited<ReturnType<(typeof getQ)["run"]>>;
type _get = Expect<Equal<GetRes, App<typeof Post> | undefined>>; // get() -> row | undefined

const countQ = select(Post).count();
type CountRes = Awaited<ReturnType<(typeof countQ)["run"]>>;
type _count = Expect<Equal<CountRes, number>>; // count() -> number

// Operator narrowing: string ops exist on string columns only; contains* on arrays.
// Ratified cross-driver vocab: STRING substring = .includes; ARRAY membership = .contains*.
const _stringOps = () => select(Post).where((p) => p.title.startsWith("a"));
const _stringIncludes = () => select(Post).where((p) => p.title.includes("a"));
const _arrayOps = () => select(Post).where((p) => p.tags.containsAny(["a"]));
// @ts-expect-error — startsWith is a string op; views is an int column
const _badStr = () => select(Post).where((p) => p.views.startsWith("a"));
// @ts-expect-error — containsAll is an array op; title is a string column
const _badArr = () => select(Post).where((p) => p.title.containsAll(["a"]));
// @ts-expect-error — .contains is ARRAY membership; a string column takes .includes
const _badStrContains = () => select(Post).where((p) => p.title.contains("a"));
// @ts-expect-error — .includes is the STRING substring op; an array column takes .contains
const _badArrIncludes = () => select(Post).where((p) => p.tags.includes("a"));
// @ts-expect-error — in() takes the column's type
const _badIn = () => select(Post).where((p) => p.views.in(["not-a-number"]));

describe("phase-1 lowering", () => {
  test("in / notIn bind the whole array", () => {
    const { sql, vars } = select(Post)
      .where((p) => and(p.title.in(["a", "b"]), p.views.notIn([1, 2])))
      .toSQL();
    expect(sql).toContain(`${escapeIdent("title")} IN $b0`);
    expect(sql).toContain(`${escapeIdent("views")} NOT IN $b1`);
    expect(vars).toEqual({ b0: ["a", "b"], b1: [1, 2] });
  });

  test("array contains / containsAny / containsAll", () => {
    const { sql } = select(Post)
      .where((p) =>
        and(
          p.tags.contains("x"),
          p.tags.containsAny(["a"]),
          p.tags.containsAll(["a", "b"]),
        ),
      )
      .toSQL();
    expect(sql).toContain(`${escapeIdent("tags")} CONTAINS $b0`);
    expect(sql).toContain(`${escapeIdent("tags")} CONTAINSANY $b1`);
    expect(sql).toContain(`${escapeIdent("tags")} CONTAINSALL $b2`);
  });

  test("string includes lowers to the native CONTAINS (substring)", () => {
    const { sql, vars } = select(Post)
      .where((p) => p.title.includes("hi"))
      .toSQL();
    expect(sql).toContain(`${escapeIdent("title")} CONTAINS $b0`);
    expect(vars).toEqual({ b0: "hi" });
  });

  test("startsWith / endsWith lower to string:: functions", () => {
    const { sql, vars } = select(Post)
      .where((p) => and(p.title.startsWith("he"), p.title.endsWith("lo")))
      .toSQL();
    expect(sql).toContain(`string::starts_with(${escapeIdent("title")}, $b0)`);
    expect(sql).toContain(`string::ends_with(${escapeIdent("title")}, $b1)`);
    expect(vars).toEqual({ b0: "he", b1: "lo" });
  });

  test("isNone / isNotNone lower to literal NONE (no bind)", () => {
    const { sql, vars } = select(Post)
      .where((p) => and(p.nick.isNone(), p.title.isNotNone()))
      .toSQL();
    expect(sql).toContain(`${escapeIdent("nick")} = NONE`);
    expect(sql).toContain(`${escapeIdent("title")} != NONE`);
    expect(vars).toEqual({});
  });

  test("start pairs with limit for pagination (LIMIT before START)", () => {
    const { sql } = select(Post).limit(10).start(20).toSQL();
    expect(sql).toContain("LIMIT 10 START 20");
  });

  test("one() -> FROM ONLY … LIMIT 1; get() targets ONLY $__thing", () => {
    expect(select(Post).one().toSQL().sql).toContain("LIMIT 1");
    const { sql, vars } = get(Post, "a1").toSQL();
    expect(sql).toContain("FROM ONLY $__thing");
    expect(sql).toContain("LIMIT 1");
    expect(vars.__thing).toBeInstanceOf(RecordId);
    expect((vars.__thing as RecordId).table.name).toBe("p1_post");
  });

  test("count() keeps WHERE, drops order/limit/projection", () => {
    const { sql, vars } = select(Post)
      .where((p) => p.views.gt(5))
      .orderBy((p) => p.title)
      .limit(3)
      .count()
      .toSQL();
    expect(sql).toBe(
      `SELECT count() FROM ${escapeIdent("p1_post")} WHERE ${escapeIdent("views")} > $b0 GROUP ALL`,
    );
    expect(vars).toEqual({ b0: 5 });
  });

  test("unbound one()/count() reject with clear guidance", async () => {
    await expect(select(Post).one().run()).rejects.toThrow(
      /not bound to a connection/,
    );
    await expect(select(Post).count().run()).rejects.toThrow(
      /not bound to a connection/,
    );
  });
});

// --- live semantics (SURREAL_URL-gated) ------------------------------------------------------------
const URL = process.env.SURREAL_URL;

describe.skipIf(!URL)("phase-1 live semantics", () => {
  async function conn(): Promise<Surreal> {
    const c = new Surreal();
    await c.connect(URL as string);
    await c.signin({ username: "root", password: "root" });
    await c.use({ namespace: "q_p1", database: "q_p1" });
    await c.query(`
      REMOVE TABLE IF EXISTS p1_post;
      CREATE p1_post:pa SET title = 'alpha', tags = ['a','b'], views = 10;
      CREATE p1_post:pb SET title = 'beta', tags = ['b','c'], views = 20, nick = 'b';
      CREATE p1_post:pc SET title = 'alphabet', tags = [], views = 30;
    `);
    return c;
  }

  test("operators + pagination + terminals against a live DB", async () => {
    const c = await conn();

    const inRows = await select(Post)
      .where((p) => p.title.in(["alpha", "beta"]))
      .orderBy((p) => p.title)
      .run(c);
    expect(inRows.map((r) => r.title)).toEqual(["alpha", "beta"]);

    const anyTag = await select(Post)
      .where((p) => p.tags.containsAny(["a", "c"]))
      .orderBy((p) => p.title)
      .run(c);
    expect(anyTag.map((r) => r.title)).toEqual(["alpha", "beta"]);

    const starts = await select(Post)
      .where((p) => p.title.startsWith("alpha"))
      .orderBy((p) => p.title)
      .run(c);
    expect(starts.map((r) => r.title)).toEqual(["alpha", "alphabet"]);

    const noNick = await select(Post)
      .where((p) => p.nick.isNone())
      .orderBy((p) => p.title)
      .run(c);
    expect(noNick.map((r) => r.title)).toEqual(["alpha", "alphabet"]);

    const page2 = await select(Post)
      .orderBy((p) => p.views)
      .limit(1)
      .start(1)
      .run(c);
    expect(page2[0]?.views).toBe(20);

    const first = await select(Post)
      .where((p) => p.views.gt(15))
      .orderBy((p) => p.views)
      .one()
      .run(c);
    expect(first?.views).toBe(20);
    const missing = await select(Post)
      .where((p) => p.views.gt(999))
      .one()
      .run(c);
    expect(missing).toBeUndefined();

    const got = await get(Post, "pb").run(c);
    expect(got?.title).toBe("beta");
    expect(got && String(got.id.table.name)).toBe("p1_post");
    expect(await get(Post, "nope").run(c)).toBeUndefined();

    expect(
      await select(Post)
        .where((p) => p.views.gte(20))
        .count()
        .run(c),
    ).toBe(2);
    expect(await select(Post).count().run(c)).toBe(3);
    expect(
      await select(Post)
        .where((p) => p.views.gt(999))
        .count()
        .run(c),
    ).toBe(0);

    await c.query("REMOVE TABLE IF EXISTS p1_post;");
    await c.close();
  });
});
