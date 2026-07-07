// @schemic/surrealdb/query WRITES (ORM P2): the split builders create(T).content(data) /
// update(T, id).merge|content|set / remove(T, id) — SurrealQL lowering, codec-channel validation
// (fail-fast ZodError at the call site), RETURN modes + the shared projection callback, and
// type-level proof of the result shapes.

import { describe, expect, test } from "bun:test";
import { DateTime, escapeIdent, RecordId } from "surrealdb";
import { z } from "zod";
import { defineTable, s, surql } from "../../src/index";
import type { App } from "../../src/pure";
import { create, remove, update, upsert } from "../../src/query";

const Post = defineTable("post", {
  title: s.string(),
  views: s.int().$default(surql`0`),
  createdAt: s.datetime().$default(surql`time::now()`).$readonly(),
});

// --- type-level assertions -----------------------------------------------------------------------
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// Array by default (SurrealDB-faithful): every write returns an array; `.only()` unwraps to single.
const createQ = create(Post).content({ title: "hi" });
type CreateRes = Awaited<ReturnType<(typeof createQ)["run"]>>;
type _create = Expect<Equal<CreateRes, App<typeof Post>[]>>; // create -> array of created rows

const createOnlyQ = create(Post).content({ title: "hi" }).only();
type CreateOnlyRes = Awaited<ReturnType<(typeof createOnlyQ)["run"]>>;
type _createOnly = Expect<Equal<CreateOnlyRes, App<typeof Post> | undefined>>; // .only() -> single

const noneQ = create(Post).content({ title: "hi" }).return("none");
type NoneRes = Awaited<ReturnType<(typeof noneQ)["run"]>>;
type _none = Expect<Equal<NoneRes, undefined[]>>; // RETURN NONE -> empty array (no per-row data)

const projQ = update(Post, "p1")
  .merge({ title: "yo" })
  .return((p) => ({ t: p.title }));
type ProjRes = Awaited<ReturnType<(typeof projQ)["run"]>>;
type _proj = Expect<Equal<ProjRes, { t: string }[]>>; // projection -> array of decoded shapes

const delQ = remove(Post, "p1");
type DelRes = Awaited<ReturnType<(typeof delQ)["run"]>>;
type _del = Expect<Equal<DelRes, undefined[]>>; // delete -> nothing by default

const delBeforeQ = remove(Post, "p1").return("before");
type DelBeforeRes = Awaited<ReturnType<(typeof delBeforeQ)["run"]>>;
type _delBefore = Expect<Equal<DelBeforeRes, App<typeof Post>[]>>; // -> the deleted rows

// The Update codec shape excludes readonly fields at the type level:
// @ts-expect-error — createdAt is $readonly, not part of the Update patch
const _badMerge = () => update(Post, "p1").merge({ createdAt: new Date() });

describe("write builders — lowering", () => {
  test("create(T).content(data) -> CREATE <table> CONTENT $__content RETURN AFTER", () => {
    const { sql, vars } = create(Post).content({ title: "hi" }).toSQL();
    expect(sql).toBe(
      `CREATE ${escapeIdent("post")} CONTENT $__content RETURN AFTER`,
    );
    // The payload went through the codec: provided keys only (DB fills the defaults).
    expect(vars.__content).toEqual({ title: "hi" });
  });

  test("create() without .content throws a teaching error", () => {
    expect(() => create(Post).toSQL()).toThrow(/call `.content\(data\)`/);
  });

  test("update(T, id).merge -> UPDATE $__thing MERGE $__payload; string id becomes a RecordId", () => {
    const { sql, vars } = update(Post, "p1").merge({ title: "yo" }).toSQL();
    expect(sql).toBe("UPDATE $__thing MERGE $__payload RETURN AFTER");
    expect(vars.__thing).toBeInstanceOf(RecordId);
    expect((vars.__thing as RecordId).table.name).toBe("post");
    expect(vars.__payload).toEqual({ title: "yo" });
  });

  test("update(T, recordId) uses the RecordId as-is", () => {
    const rid = Post.record().for("p9");
    const { vars } = update(Post, rid).merge({ title: "x" }).toSQL();
    expect(vars.__thing).toBe(rid);
  });

  test("update .content replaces (CONTENT), .set lowers to per-field SET binds", () => {
    const content = update(Post, "p1").content({ title: "full" }).toSQL();
    expect(content.sql).toBe("UPDATE $__thing CONTENT $__payload RETURN AFTER");

    const set = update(Post, "p1").set({ title: "a", views: 2 }).toSQL();
    expect(set.sql).toBe(
      `UPDATE $__thing SET ${escapeIdent("title")} = $__s0, ${escapeIdent("views")} = $__s1 RETURN AFTER`,
    );
    expect(set.vars.__s0).toBe("a");
    expect(set.vars.__s1).toBe(2);
  });

  test("update() without a patch throws a teaching error", () => {
    expect(() => update(Post, "p1").toSQL()).toThrow(
      /call `.merge\(patch\)`, `.content\(row\)`, or `.set\(patch\)`/,
    );
  });

  test("remove(T, id) -> DELETE $__thing RETURN NONE; .return('before') flips it", () => {
    expect(remove(Post, "p1").toSQL().sql).toBe("DELETE $__thing RETURN NONE");
    expect(remove(Post, "p1").return("before").toSQL().sql).toBe(
      "DELETE $__thing RETURN BEFORE",
    );
  });

  test(".return(projection) lowers to a RETURN column list (aliased when renamed)", () => {
    const { sql } = update(Post, "p1")
      .merge({ title: "x" })
      .return((p) => ({ title: p.title, v: p.views }))
      .toSQL();
    expect(sql).toBe(
      `UPDATE $__thing MERGE $__payload RETURN ${escapeIdent("title")}, ${escapeIdent("views")} AS ${escapeIdent("v")}`,
    );
  });
});

describe("bulk writes — whole-table + filtered (no id)", () => {
  test("update(T) targets the whole table by name (not $__thing)", () => {
    const { sql, vars } = update(Post)
      .set((p) => ({ views: p.views.plus(1) }))
      .toSQL();
    expect(sql).toMatch(
      new RegExp(
        `^UPDATE ${escapeIdent("post")} SET views = views \\+ \\$r\\d+ RETURN AFTER$`,
      ),
    );
    expect(vars.__thing).toBeUndefined(); // no record-id bind — it's a table target
  });

  test("update(T).where(...) filters the whole-table update", () => {
    const { sql, vars } = update(Post)
      .set({ title: "hot" })
      .where((p) => p.views.gt(10))
      .toSQL();
    expect(sql).toBe(
      `UPDATE ${escapeIdent("post")} SET ${escapeIdent("title")} = $__s0 WHERE views > $b1 RETURN AFTER`,
    );
    expect(vars.__s0).toBe("hot");
    expect(vars.b1).toBe(10);
  });

  test("remove(T) deletes the whole table; .where(...) filters it", () => {
    expect(remove(Post).toSQL().sql).toBe(
      `DELETE ${escapeIdent("post")} RETURN NONE`,
    );
    const { sql, vars } = remove(Post)
      .where((p) => p.views.lt(1))
      .return("before")
      .toSQL();
    expect(sql).toBe(
      `DELETE ${escapeIdent("post")} WHERE views < $b0 RETURN BEFORE`,
    );
    expect(vars.b0).toBe(1);
  });

  test("a by-id target still accepts .where as a conditional guard (optimistic write)", () => {
    const { sql, vars } = update(Post, "p1")
      .set({ title: "x" })
      .where((p) => p.views.eq(5))
      .toSQL();
    expect(sql).toBe(
      `UPDATE $__thing SET ${escapeIdent("title")} = $__s0 WHERE views = $b2 RETURN AFTER`,
    );
    expect(vars.__thing).toBeInstanceOf(RecordId);
    expect(vars.b2).toBe(5);
  });
});

describe("upsert — create-or-update (same builder shape as update)", () => {
  test("upsert(T, id) lowers to UPSERT with each patch mode", () => {
    expect(upsert(Post, "p1").merge({ title: "x" }).toSQL().sql).toBe(
      "UPSERT $__thing MERGE $__payload RETURN AFTER",
    );
    expect(upsert(Post, "p1").content({ title: "x" }).toSQL().sql).toBe(
      "UPSERT $__thing CONTENT $__payload RETURN AFTER",
    );
    expect(upsert(Post, "p1").set({ title: "a", views: 2 }).toSQL().sql).toBe(
      `UPSERT $__thing SET ${escapeIdent("title")} = $__s0, ${escapeIdent("views")} = $__s1 RETURN AFTER`,
    );
  });

  test("upsert(T) (no id) targets the table by name — mints a new row", () => {
    const { sql, vars } = upsert(Post)
      .set((p) => ({ views: p.views.plus(1) }))
      .toSQL();
    expect(sql).toMatch(
      new RegExp(
        `^UPSERT ${escapeIdent("post")} SET views = views \\+ \\$r\\d+ RETURN AFTER$`,
      ),
    );
    expect(vars.__thing).toBeUndefined();
  });

  test("upsert(T).where(...) filters a bulk upsert; .only() -> UPSERT ONLY", () => {
    expect(
      upsert(Post)
        .set({ title: "hot" })
        .where((p) => p.views.gt(10))
        .toSQL().sql,
    ).toBe(
      `UPSERT ${escapeIdent("post")} SET ${escapeIdent("title")} = $__s0 WHERE views > $b1 RETURN AFTER`,
    );
    expect(upsert(Post, "p1").set({ title: "z" }).only().toSQL().sql).toBe(
      `UPSERT ONLY $__thing SET ${escapeIdent("title")} = $__s0 RETURN AFTER`,
    );
  });

  test("upsert() without a patch throws — the error names upsert, not update", () => {
    expect(() => upsert(Post, "p1").toSQL()).toThrow(/upsert\(\) has no patch/);
  });
});

describe("output mode — .only() emits ONLY (single row instead of an array)", () => {
  test("create/update/remove .only() splice ONLY right after the verb", () => {
    expect(create(Post).content({ title: "x" }).only().toSQL().sql).toBe(
      `CREATE ONLY ${escapeIdent("post")} CONTENT $__content RETURN AFTER`,
    );
    expect(update(Post, "p1").merge({ title: "x" }).only().toSQL().sql).toBe(
      "UPDATE ONLY $__thing MERGE $__payload RETURN AFTER",
    );
    expect(remove(Post, "p1").only().toSQL().sql).toBe(
      "DELETE ONLY $__thing RETURN NONE",
    );
  });

  test("ONLY composes with a bulk filtered update", () => {
    expect(
      update(Post)
        .set({ title: "z" })
        .where((p) => p.title.eq("q"))
        .only()
        .toSQL().sql,
    ).toBe(
      `UPDATE ONLY ${escapeIdent("post")} SET ${escapeIdent("title")} = $__s0 WHERE title = $b1 RETURN AFTER`,
    );
  });
});

describe("write builders — codec-channel validation (fail-fast)", () => {
  test(".content validates via the Create codec AT THE CALL SITE", () => {
    // title must be a string — the ZodError throws on .content, not at await/run.
    expect(() =>
      create(Post).content({ title: 42 as unknown as string }),
    ).toThrow(z.ZodError);
  });

  test(".merge validates via the Update codec AT THE CALL SITE", () => {
    expect(() =>
      update(Post, "p1").merge({ views: "many" as unknown as number }),
    ).toThrow(z.ZodError);
  });
});

describe("write builders — execution mechanics", () => {
  test("awaiting an UNBOUND builder rejects with clear guidance", async () => {
    let err: unknown;
    try {
      await create(Post).content({ title: "x" });
    } catch (e) {
      err = e;
    }
    expect(String(err)).toMatch(/not bound to a connection/);
  });

  test("decodeRows: RETURN AFTER decodes the single row through the table codec", () => {
    const q = create(Post).content({ title: "hi" });
    const wire = {
      id: new RecordId("post", "p1"),
      title: "hi",
      views: 0,
      createdAt: new DateTime("2026-01-01T00:00:00Z"),
    };
    const [row] = q.decodeRows([wire]);
    expect(row.title).toBe("hi");
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  test("decodeRows: RETURN NONE yields an empty array; a projection decodes the picked fields", () => {
    expect(
      create(Post).content({ title: "x" }).return("none").decodeRows([]),
    ).toEqual([]);

    const q = update(Post, "p1")
      .merge({ title: "x" })
      .return((p) => ({ t: p.title }));
    expect(q.decodeRows([{ t: "hello" }])).toEqual([{ t: "hello" }]);
  });
});

describe(".set callback — typed row expressions", () => {
  test("p.views.plus(1) lowers to SET views = views + $r<n>", () => {
    const { sql, vars } = update(Post, "p1")
      .set((p) => ({ views: p.views.plus(1) }))
      .toSQL();
    expect(sql).toMatch(
      /^UPDATE \$__thing SET views = views \+ \$r\d+ RETURN AFTER$/,
    );
    expect(Object.values(vars)).toContain(1);
  });

  test("literals mix in and still go through the codec channel", () => {
    const { sql, vars } = update(Post, "p1")
      .set((p) => ({ title: "renamed", views: p.views.times(2) }))
      .toSQL();
    expect(sql).toContain("title = $__s0");
    expect(sql).toMatch(/views = views \* \$r\d+/);
    expect(vars.__s0).toBe("renamed");
  });

  test("surql fragments are accepted as values", () => {
    const { sql } = update(Post, "p1")
      .set(() => ({ views: surql`views + 1`.as<number>() }))
      .toSQL();
    expect(sql).toContain("views = (views + 1)");
  });

  test("typed: a wrong-typed expression is a compile error", () => {
    const _bad = () =>
      update(Post, "p1")
        // @ts-expect-error — title is a string; a number expression doesn't fit
        .set((p) => ({ title: p.views.plus(1) }));
    expect(typeof _bad).toBe("function");
  });

  test("empty callback patch throws with guidance", () => {
    expect(() =>
      update(Post, "p1")
        .set(() => ({}))
        .toSQL(),
    ).toThrow(/empty patch/);
  });
});

// --- live (SURREAL_URL-gated) ---------------------------------------------------------------------
const LIVE_URL = process.env.SURREAL_URL;

describe.skipIf(!LIVE_URL)(".set callback live", () => {
  test("increment round-trips", async () => {
    const { Surreal } = await import("surrealdb");
    const { emitTable } = await import("../../src/ddl");
    const c = new Surreal();
    await c.connect(LIVE_URL as string);
    await c.signin({ username: "root", password: "root" });
    await c.use({ namespace: "qw", database: "qw" });
    await c.query("REMOVE TABLE IF EXISTS post;");
    await c.query(emitTable(Post, { exists: "overwrite" }));
    await c.query("CREATE post:p1 SET title = 'hi', views = 41;");
    const row = await update(Post, "p1")
      .set((p) => ({ views: p.views.plus(1) }))
      .only()
      .run(c);
    expect(row?.views).toBe(42);
    await c.query("REMOVE TABLE IF EXISTS post;");
    await c.close();
  }, 60_000);
});
