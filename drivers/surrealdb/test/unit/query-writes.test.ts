// @schemic/surrealdb/query WRITES (ORM P2): the split builders create(T).content(data) /
// update(T, id).merge|content|set / remove(T, id) — SurrealQL lowering, codec-channel validation
// (fail-fast ZodError at the call site), RETURN modes + the shared projection callback, and
// type-level proof of the result shapes.

import { describe, expect, test } from "bun:test";
import { DateTime, escapeIdent, RecordId } from "surrealdb";
import { z } from "zod";
import {
  defineParam,
  defineRelation,
  defineTable,
  s,
  surql,
} from "../../src/index";
import type { App } from "../../src/pure";
import type {
  AnyCount,
  AnySelect,
  AnyStatement,
  AnyUpdate,
} from "../../src/query";
import {
  block,
  create,
  relate,
  remove,
  select,
  update,
  upsert,
} from "../../src/query";

const Post = defineTable("post", {
  title: s.string(),
  views: s.int().$default(surql`0`),
  createdAt: s.datetime().$default(surql`time::now()`).$readonly(),
});

// Every field optional/defaulted -> a contentless CREATE is valid, so `create(Note)` is runnable.
const Note = defineTable("note", {
  body: s.string().optional(),
  views: s.int().$default(surql`0`),
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

  test("create(T, id).content(data) -> CREATE $__thing CONTENT (that specific record)", () => {
    const { sql, vars } = create(Post, "p1").content({ title: "hi" }).toSQL();
    expect(sql).toBe("CREATE $__thing CONTENT $__content RETURN AFTER");
    expect(vars.__thing).toBeInstanceOf(RecordId);
    expect((vars.__thing as RecordId).table.name).toBe("post");
    expect(String(vars.__thing)).toBe("post:p1");
    expect(create(Post, "p1").content({ title: "x" }).only().toSQL().sql).toBe(
      "CREATE ONLY $__thing CONTENT $__content RETURN AFTER",
    );
  });

  test("contentless CREATE on an all-optional table (empty record; schema defaults fill in)", () => {
    // Note is all-optional -> create(Note) is a ready CreateQuery; .content() is optional.
    expect(create(Note).toSQL().sql).toBe(
      `CREATE ${escapeIdent("note")} RETURN AFTER`,
    );
    const { sql, vars } = create(Note, "n1").toSQL();
    expect(sql).toBe("CREATE $__thing RETURN AFTER");
    expect(String(vars.__thing)).toBe("note:n1");
    expect(vars.__content).toBeUndefined(); // no CONTENT clause, no bind
  });

  test("required-field table: a contentless create is a COMPILE error until .content()", () => {
    // Post has a required `title`, so create(Post) is a PendingCreate — not runnable yet.
    // @ts-expect-error — no `.toSQL()` on a pending create (must supply .content() first)
    const _pending = () => create(Post).toSQL();
    // @ts-expect-error — a pending create is not a complete AnyStatement
    const _notStmt: AnyStatement = create(Post);
    // .content() unlocks the runnable CreateQuery
    const ok: AnyStatement = create(Post).content({ title: "x" });
    expect(ok.toSQL().sql).toContain("CONTENT");
    expect(typeof _pending).toBe("function");
    void _notStmt;
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
  test("update(T).all() targets the whole table by name (not $__thing)", () => {
    const { sql, vars } = update(Post)
      .all()
      .set((p) => ({ views: p.views.plus(1) }))
      .toSQL();
    expect(sql).toMatch(
      new RegExp(
        `^UPDATE ${escapeIdent("post")} SET views = views \\+ \\$r\\d+ RETURN AFTER$`,
      ),
    );
    expect(vars.__thing).toBeUndefined(); // no record-id bind — it's a table target
  });

  test("update(T).where(...) filters the whole-table update (no .all() needed)", () => {
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

  test("remove(T).all() deletes the whole table; .where(...) filters it", () => {
    expect(remove(Post).all().toSQL().sql).toBe(
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

describe("bulk safeguard — unscoped whole-table writes require .all()", () => {
  test("update(T) with no id and no .where throws (points at .where / .all)", () => {
    expect(() => update(Post).set({ title: "x" }).toSQL()).toThrow(
      /rewrite EVERY row.*\.where.*\.all\(\)/s,
    );
  });

  test("remove(T) with no id and no .where throws (DELETE every row)", () => {
    expect(() => remove(Post).toSQL()).toThrow(
      /DELETE EVERY row.*\.where.*\.all\(\)/s,
    );
  });

  test("upsert(T) with no id and no .where throws (would INSERT a new row; steer to create)", () => {
    expect(() => upsert(Post).set({ title: "x" }).toSQL()).toThrow(
      /INSERTS a new row.*create\(post\).*\.all\(\)/s,
    );
  });

  test(".all() lifts the guard; a .where() scope removes the need for it", () => {
    expect(() => update(Post).all().set({ title: "x" }).toSQL()).not.toThrow();
    expect(() => remove(Post).all().toSQL()).not.toThrow();
    expect(() =>
      update(Post)
        .set({ title: "x" })
        .where((p) => p.views.gt(0))
        .toSQL(),
    ).not.toThrow();
  });

  test("a by-id target is never guarded (it targets one record)", () => {
    expect(() => update(Post, "p1").set({ title: "x" }).toSQL()).not.toThrow();
    expect(() => remove(Post, "p1").toSQL()).not.toThrow();
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

  test("upsert(T).all() (no id) targets the table by name — mints a new row", () => {
    const { sql, vars } = upsert(Post)
      .all()
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

describe("Any* widened aliases — receive a builder regardless of type params", () => {
  test("AnySelect accepts any output mode (the Single-mismatch that broke Select<any,any>)", () => {
    const sels: AnySelect[] = [
      select(Post),
      select(Post, "p1").only(),
      select(Post).one(),
      select(Post).raw(),
    ];
    for (const s2 of sels) expect(s2.toSQL().sql).toBeTypeOf("string");
  });

  test("AnyStatement spans select + writes (common surface: .toSQL()/.raw())", () => {
    const stmts: AnyStatement[] = [
      select(Post, "p1").only(),
      create(Post).content({ title: "x" }),
      update(Post, "p1").merge({ title: "x" }),
      remove(Post, "p1").return("before"),
    ];
    for (const st of stmts) {
      expect(st.toSQL().sql).toBeTypeOf("string");
      expect(st.raw()).toBeDefined(); // every member opts out of decode
    }
    const _u: AnyUpdate = upsert(Post, "p1").merge({ title: "x" }); // shares the update builder
    const _c: AnyCount = select(Post).count(); // scalar — kept out of AnyStatement
    expect(_u.toSQL().sql).toContain("UPSERT");
    expect(_c).toBeDefined();
  });

  test(".kind discriminates every builder at runtime (upsert split from update)", () => {
    expect(select(Post).kind).toBe("select");
    expect(create(Post).kind).toBe("create");
    expect(update(Post, "p1").kind).toBe("update");
    expect(upsert(Post, "p1").kind).toBe("upsert"); // distinct from update
    expect(remove(Post, "p1").kind).toBe("delete");
    expect(select(Post).count().kind).toBe("count");
    // survives output-mode chaining (the discriminant persists through clones)
    expect(select(Post, "p1").only().kind).toBe("select");
    expect(update(Post, "p1").merge({ title: "x" }).only().kind).toBe("update");
  });
});

describe("relate — RELATE from -> edge -> to", () => {
  const RUser = defineTable("r_user", { name: s.string() });
  const RPost = defineTable("r_post", { title: s.string() });
  const Likes = defineRelation("likes", {
    rating: s.int(),
    at: s.datetime().optional(),
  })
    .from(RUser)
    .to(RPost);
  const alice = RUser.record().for("alice");
  const bob = RUser.record().for("bob");
  const post = RPost.record().for("p1");

  test("basic RELATE lowers to from->edge->to with SET + RETURN AFTER", () => {
    const { sql, vars } = relate(alice, Likes, post).set({ rating: 5 }).toSQL();
    expect(sql).toBe(
      `RELATE $__from->${escapeIdent("likes")}->$__to SET ${escapeIdent("rating")} = $__s0 RETURN AFTER`,
    );
    expect(String(vars.__from)).toBe("r_user:alice");
    expect(String(vars.__to)).toBe("r_post:p1");
    expect(vars.__s0).toBe(5);
  });

  test("CONTENT sets the whole edge body (in/out come from the path)", () => {
    const { sql, vars } = relate(alice, Likes, post)
      .content({ rating: 3 })
      .toSQL();
    expect(sql).toBe(
      `RELATE $__from->${escapeIdent("likes")}->$__to CONTENT $__content RETURN AFTER`,
    );
    expect(vars.__content).toEqual({ rating: 3 });
  });

  test(".id(...) pins the edge record id; .only() -> RELATE ONLY", () => {
    expect(
      relate(alice, Likes, post).id("custom").set({ rating: 1 }).toSQL().sql,
    ).toBe(
      `RELATE $__from->likes:custom->$__to SET ${escapeIdent("rating")} = $__s0 RETURN AFTER`,
    );
    expect(
      relate(alice, Likes, post).set({ rating: 1 }).only().toSQL().sql,
    ).toBe(
      `RELATE ONLY $__from->${escapeIdent("likes")}->$__to SET ${escapeIdent("rating")} = $__s0 RETURN AFTER`,
    );
  });

  test(".timeout comes AFTER return; .set callback lowers edge expressions", () => {
    expect(
      relate(alice, Likes, post).set({ rating: 2 }).timeout("5s").toSQL().sql,
    ).toBe(
      `RELATE $__from->${escapeIdent("likes")}->$__to SET ${escapeIdent("rating")} = $__s0 RETURN AFTER TIMEOUT 5s`,
    );
    expect(
      relate(alice, Likes, post)
        .set((e) => ({ rating: e.rating.plus(1) }))
        .toSQL().sql,
    ).toMatch(
      new RegExp(
        `^RELATE \\$__from->${escapeIdent("likes")}->\\$__to SET rating = rating \\+ \\$r\\d+ RETURN AFTER$`,
      ),
    );
  });

  test("array endpoints fan out; a surql subquery endpoint splices as (…)", () => {
    const fan = relate([alice, bob], Likes, post).set({ rating: 1 }).toSQL();
    expect(Array.isArray(fan.vars.__from)).toBe(true);
    expect((fan.vars.__from as unknown[]).map(String)).toEqual([
      "r_user:alice",
      "r_user:bob",
    ]);

    const sub = relate(surql`SELECT * FROM r_user`, Likes, post).toSQL();
    expect(sub.sql).toBe(
      `RELATE (SELECT * FROM r_user)->${escapeIdent("likes")}->$__to RETURN AFTER`,
    );
  });

  test("endpoints are type-checked against the edge's .from()/.to()", () => {
    // @ts-expect-error — a post can't be the SOURCE (from must be a r_user)
    const _badFrom = () => relate(post, Likes, post);
    // @ts-expect-error — a user can't be the TARGET (to must be a r_post)
    const _badTo = () => relate(alice, Likes, alice);
    expect(typeof _badFrom).toBe("function");
    expect(typeof _badTo).toBe("function");
  });

  // A `$param` / block-var endpoint must SPLICE as its `$name`, never bind — binding it would hand
  // the DB the literal ref object instead of the record it names.
  describe("reference endpoints splice as $name (never bind)", () => {
    test("a bare $param (surql.$) splices, contributing no bindings", () => {
      const { sql, vars } = relate(surql.$.a, Likes, surql.$.b).toSQL();
      expect(sql).toBe(`RELATE $a->${escapeIdent("likes")}->$b RETURN AFTER`);
      expect(Object.keys(vars)).toEqual([]);
    });

    test("a defineParam def IS its $name reference", () => {
      const Home = defineParam("home_user");
      const { sql, vars } = relate(Home, Likes, post).toSQL();
      expect(sql).toBe(
        `RELATE $home_user->${escapeIdent("likes")}->$__to RETURN AFTER`,
      );
      expect(Object.keys(vars)).toEqual(["__to"]);
    });

    test("a block FOR loop var relates without dropping to raw surql", () => {
      // The unlock: `FOR $u IN (SELECT * FROM r_user) { RELATE $u->likes->$__to }`. SurrealDB coerces
      // the row object at an endpoint back to its id (verified on 3.1.4).
      const { query } = block()
        .for({ u: select(RUser) }, (v) => relate(v.u, Likes, post))
        .toQuery();
      expect(query).toContain("FOR $u IN (SELECT * FROM r_user)");
      // `$u` SPLICES; the `post` endpoint still binds (the block renames inner binds, so match the
      // splice + the bind's `$`-prefix rather than its generated name).
      expect(query).toMatch(
        new RegExp(`RELATE \\$u->${escapeIdent("likes")}->\\$\\w+`),
      );
    });

    test("a LET block var works at either endpoint", () => {
      const { query } = block()
        .let({ target: select(RPost) })
        .for({ u: select(RUser) }, (v) => relate(v.u, Likes, v.target))
        .toQuery();
      expect(query).toContain(`RELATE $u->${escapeIdent("likes")}->$target`);
    });

    test("a ref of the WRONG table is still a compile error", () => {
      const _bad = () =>
        block().for({ p: select(RPost) }, (v) =>
          // @ts-expect-error — an r_post ref can't be the SOURCE (from must be an r_user)
          relate(v.p, Likes, post),
        );
      expect(typeof _bad).toBe("function");
    });

    test("plain records still BIND under $__from/$__to (no regression)", () => {
      const { sql, vars } = relate(alice, Likes, post).toSQL();
      expect(sql).toBe(
        `RELATE $__from->${escapeIdent("likes")}->$__to RETURN AFTER`,
      );
      expect(String(vars.__from)).toBe("r_user:alice");
      expect(String(vars.__to)).toBe("r_post:p1");
    });
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

describe.skipIf(!LIVE_URL)("relate live", () => {
  test("single + fan-out + pinned edge id round-trip", async () => {
    const { Surreal } = await import("surrealdb");
    const { emitTable } = await import("../../src/ddl");
    const RU = defineTable("rl_u", { name: s.string() });
    const RP = defineTable("rl_p", { title: s.string() });
    const Likes = defineRelation("rl_likes", { rating: s.int() })
      .from(RU)
      .to(RP);
    const c = new Surreal();
    await c.connect(LIVE_URL as string);
    await c.signin({ username: "root", password: "root" });
    await c.use({ namespace: "qw", database: "qw" });
    for (const t of ["rl_u", "rl_p", "rl_likes"])
      await c.query(`REMOVE TABLE IF EXISTS ${t};`);
    for (const T of [RU, RP, Likes])
      await c.query(emitTable(T, { exists: "overwrite" }));
    const alice = (await create(RU).content({ name: "alice" }).only().run(c))!;
    const bob = (await create(RU).content({ name: "bob" }).only().run(c))!;
    const p1 = (await create(RP).content({ title: "hi" }).only().run(c))!;

    const edge = await relate(alice.id, Likes, p1.id)
      .set({ rating: 5 })
      .only()
      .run(c);
    expect(edge?.rating).toBe(5);
    expect(edge?.in.id).toBe(alice.id.id); // in/out decode to the endpoint records
    expect(edge?.out.id).toBe(p1.id.id);

    const fan = await relate([alice.id, bob.id], Likes, p1.id)
      .set({ rating: 3 })
      .run(c);
    expect(fan).toHaveLength(2); // one edge per source (fan-out)

    const pinned = await relate(alice.id, Likes, p1.id)
      .id("special")
      .set({ rating: 9 })
      .only()
      .run(c);
    expect(String(pinned?.id)).toBe("rl_likes:special");

    for (const t of ["rl_u", "rl_p", "rl_likes"])
      await c.query(`REMOVE TABLE IF EXISTS ${t};`);
    await c.close();
  }, 60_000);
});
