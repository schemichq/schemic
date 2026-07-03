// @schemic/surrealdb/query WRITES (ORM P2): the split builders create(T).content(data) /
// update(T, id).merge|content|set / remove(T, id) — SurrealQL lowering, codec-channel validation
// (fail-fast ZodError at the call site), RETURN modes + the shared projection callback, and
// type-level proof of the result shapes.

import { describe, expect, test } from "bun:test";
import { DateTime, escapeIdent, RecordId } from "surrealdb";
import { z } from "zod";
import { defineTable, s, surql } from "../../src/index";
import type { App } from "../../src/pure";
import { create, remove, update } from "../../src/query";

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

const createQ = create(Post).content({ title: "hi" });
type CreateRes = Awaited<ReturnType<(typeof createQ)["run"]>>;
type _create = Expect<Equal<CreateRes, App<typeof Post>>>; // create -> the decoded created row

const noneQ = create(Post).content({ title: "hi" }).return("none");
type NoneRes = Awaited<ReturnType<(typeof noneQ)["run"]>>;
type _none = Expect<Equal<NoneRes, undefined>>; // RETURN NONE -> undefined

const projQ = update(Post, "p1")
  .merge({ title: "yo" })
  .return((p) => ({ t: p.title }));
type ProjRes = Awaited<ReturnType<(typeof projQ)["run"]>>;
type _proj = Expect<Equal<ProjRes, { t: string }>>; // projection -> decoded shape

const delQ = remove(Post, "p1");
type DelRes = Awaited<ReturnType<(typeof delQ)["run"]>>;
type _del = Expect<Equal<DelRes, undefined>>; // delete -> nothing by default

const delBeforeQ = remove(Post, "p1").return("before");
type DelBeforeRes = Awaited<ReturnType<(typeof delBeforeQ)["run"]>>;
type _delBefore = Expect<Equal<DelBeforeRes, App<typeof Post>>>; // -> the deleted row

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
    const row = q.decodeRows([wire]) as App<typeof Post>;
    expect(row.title).toBe("hi");
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  test("decodeRows: RETURN NONE yields undefined; a projection decodes the picked fields", () => {
    expect(
      create(Post).content({ title: "x" }).return("none").decodeRows([]),
    ).toBeUndefined();

    const q = update(Post, "p1")
      .merge({ title: "x" })
      .return((p) => ({ t: p.title }));
    expect(q.decodeRows([{ t: "hello" }])).toEqual({ t: "hello" });
  });
});
