// Typed-fragments PHASE 3 (3/3): $parent detection + subquery projections. Every builder chain
// carries a row-scope token; an OUTER ref lowered inside a DIFFERENT builder renders as
// `$parent.<col>` — so correlated subqueries fall out of `.return`/`.where` composition with no
// extra syntax. Nested builders in a projection decode through THEIR OWN codecs.
import { describe, expect, test } from "bun:test";
import { defineTable, RecordId, s, surql } from "../../src/index";
import { select } from "../../src/query";

const User = defineTable("ps_user", {
  name: s.string(),
  email: s.string(),
});
const Post = defineTable("ps_post", {
  title: s.string(),
  author: s.string(),
  views: s.number(),
});

describe("$parent lowering", () => {
  test("outer ref inside a nested .return subquery lowers to $parent.<col>", () => {
    const q = select(User).return((u) => ({
      name: u.name,
      posts: select(Post).where((p) => p.author.eq(u.name)),
    }));
    expect(q.toSQL().sql).toBe(
      "SELECT name, (SELECT * FROM ps_post WHERE author = $parent.name) AS posts FROM ps_user",
    );
  });

  test("same-row refs stay bare; only foreign-row refs go $parent", () => {
    const q = select(Post).where((p) => p.author.eq(p.title));
    expect(q.toSQL().sql).toBe("SELECT * FROM ps_post WHERE author = title");
  });

  test("outer ref as the LHS inside a nested builder also $parent-detects", () => {
    const q = select(User).return((u) => ({
      hits: select(Post).where((p) => u.name.eq(p.author)),
    }));
    expect(q.toSQL().sql).toBe(
      "SELECT (SELECT * FROM ps_post WHERE $parent.name = author) AS hits FROM ps_user",
    );
  });

  test("count()/one() terminals keep the correlation", () => {
    const q = select(User).return((u) => ({
      name: u.name,
      postCount: select(Post)
        .where((p) => p.author.eq(u.name))
        .count(),
      latest: select(Post)
        .where((p) => p.author.eq(u.name))
        .one(),
    }));
    const sql = q.toSQL().sql;
    expect(sql).toContain(
      "((SELECT count() FROM ps_post WHERE author = $parent.name GROUP ALL)[0].count OR 0) AS postCount",
    );
    expect(sql).toContain(
      "(SELECT * FROM ps_post WHERE author = $parent.name LIMIT 1)[0] AS latest",
    );
  });

  test("interpolating into a surql template renders bare (no row scope at the top level)", () => {
    const q = surql`RETURN ${select(Post).where((p) => p.views.gt(1))}`;
    expect(q.query).toMatch(/WHERE views > \$sub__\d+_b0\)/);
  });
});

describe("nested projection decode + typing", () => {
  test("nested select rows decode through the INNER table codec", () => {
    const q = select(User).return((u) => ({
      name: u.name,
      posts: select(Post).where((p) => p.author.eq(u.name)),
    }));
    const [row] = q.decodeRows([
      {
        name: "ada",
        posts: [
          {
            id: new RecordId("ps_post", "1"),
            title: "t",
            author: "ada",
            views: 3,
          },
        ],
      },
    ]) as { name: string; posts: { title: string; views: number }[] }[];
    expect(row?.name).toBe("ada");
    expect(row?.posts[0]?.title).toBe("t");
    expect(row?.posts[0]?.views).toBe(3);
  });

  test(".one() in a projection decodes a single row or undefined; count() a number", () => {
    const q = select(User).return((u) => ({
      latest: select(Post)
        .where((p) => p.author.eq(u.name))
        .one(),
      n: select(Post).count(),
    }));
    const rows = q.decodeRows([
      { latest: null, n: 0 },
      {
        latest: {
          id: new RecordId("ps_post", "2"),
          title: "x",
          author: "ada",
          views: 1,
        },
        n: 4,
      },
    ]) as { latest?: { title: string }; n: number }[];
    expect(rows[0]?.latest).toBeUndefined();
    expect(rows[0]?.n).toBe(0);
    expect(rows[1]?.latest?.title).toBe("x");
    expect(rows[1]?.n).toBe(4);
  });

  test("typed: the projection carries the nested result types", () => {
    const q = select(User).return((u) => ({
      posts: select(Post).where((p) => p.author.eq(u.name)),
      n: select(Post).count(),
    }));
    // Type-level: posts is rows[], n is number.
    type Res = Awaited<ReturnType<(typeof q)["run"]>>[number];
    const _check: Res = {
      posts: [
        {
          id: undefined as never,
          title: "t",
          author: "a",
          views: 1,
        },
      ],
      n: 2,
    };
    expect(typeof _check).toBe("object");
  });
});

// --- live (SURREAL_URL-gated): the correlation actually correlates on a real server -------------
const URL = process.env.SURREAL_URL;

describe.skipIf(!URL)("$parent live", () => {
  test("correlated projection returns per-row subrows/counts, decoded", async () => {
    const { Surreal } = await import("surrealdb");
    const { emitTable } = await import("../../src/ddl");

    const c = new Surreal();
    await c.connect(URL as string);
    await c.signin({ username: "root", password: "root" });
    await c.use({ namespace: "ps", database: "ps" });
    await c.query(
      "REMOVE TABLE IF EXISTS ps_user; REMOVE TABLE IF EXISTS ps_post;",
    );
    await c.query(emitTable(User, { exists: "overwrite" }));
    await c.query(emitTable(Post, { exists: "overwrite" }));
    await c.query(
      "CREATE ps_user:1 SET name = 'ada', email = 'a@x.dev';" +
        "CREATE ps_user:2 SET name = 'kid', email = 'k@x.dev';" +
        "CREATE ps_post:1 SET title = 'p1', author = 'ada', views = 5;" +
        "CREATE ps_post:2 SET title = 'p2', author = 'ada', views = 1;" +
        "CREATE ps_post:3 SET title = 'p3', author = 'kid', views = 0;",
    );

    const rows = await select(User)
      .return((u) => ({
        name: u.name,
        posts: select(Post).where((p) => p.author.eq(u.name)),
        n: select(Post)
          .where((p) => p.author.eq(u.name))
          .count(),
        top: select(Post)
          .where((p) => p.author.eq(u.name))
          .orderBy((p) => p.views, "desc")
          .one(),
      }))
      .orderBy((u) => u.name)
      .run(c);

    expect(rows.map((r) => ({ name: r.name, n: r.n }))).toEqual([
      { name: "ada", n: 2 },
      { name: "kid", n: 1 },
    ]);
    expect(rows[0]?.posts.map((p) => p.title).sort()).toEqual(["p1", "p2"]);
    expect(rows[0]?.top?.title).toBe("p1"); // decoded through Post's codec
    expect(rows[0]?.top?.views).toBe(5);
    expect(rows[1]?.posts.map((p) => p.title)).toEqual(["p3"]);

    await c.query(
      "REMOVE TABLE IF EXISTS ps_user; REMOVE TABLE IF EXISTS ps_post;",
    );
    await c.close();
  }, 60_000);
});
