// Reference query builder (@schemic/surrealdb/query) — de-risks @schemic/core/query end to end:
// SurrealQL lowering, decode-by-default (a datetime codec field -> real Date), and type-level proof
// that a bare select yields App<TD> and `.return(...)` yields the projected decoded shape.

import { describe, expect, test } from "bun:test";
import { DateTime, escapeIdent } from "surrealdb";
import { defineTable, s } from "../../src/index";
import type { App } from "../../src/pure";
import { and, or, select } from "../../src/query";

const Post = defineTable("post", {
  title: s.string(),
  createdAt: s.datetime(), // codec: wire DateTime <-> app Date
});

// --- type-level assertions -----------------------------------------------------------------------
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;

const bareQ = select(Post);
type BareRes = Awaited<ReturnType<(typeof bareQ)["run"]>>;
type _bare = Expect<Equal<BareRes[number], App<typeof Post>>>; // bare select -> decoded App row

const projQ = select(Post).return((p) => ({ t: p.title, when: p.createdAt }));
type ProjRes = Awaited<ReturnType<(typeof projQ)["run"]>>;
type _proj = Expect<Equal<ProjRes[number], { t: string; when: Date }>>; // projection -> decoded shape

// --- SurrealQL lowering --------------------------------------------------------------------------
describe("@schemic/surrealdb/query — lowering", () => {
  test("where + orderBy + limit -> SurrealQL + named binds", () => {
    const { sql, vars } = select(Post)
      .where((p) => p.title.eq("hi"))
      .orderBy((p) => p.createdAt, "desc")
      .limit(5)
      .toSQL();
    expect(sql).toContain(`FROM ${escapeIdent("post")}`);
    expect(sql).toContain(`${escapeIdent("title")} = $b0`);
    expect(sql).toContain(`ORDER BY ${escapeIdent("createdAt")} DESC`);
    expect(sql).toContain("LIMIT 5");
    expect(vars).toEqual({ b0: "hi" });
  });

  test("or(...) combines predicates with distinct binds", () => {
    const { sql, vars } = select(Post)
      .where((p) => or(p.title.eq("a"), p.title.eq("b")))
      .toSQL();
    expect(sql).toContain(`(${escapeIdent("title")} = $b0 OR ${escapeIdent("title")} = $b1)`);
    expect(vars).toEqual({ b0: "a", b1: "b" });
  });

  test("and(...) likewise", () => {
    const { sql } = select(Post)
      .where((p) => and(p.title.eq("a"), p.createdAt.gt(new Date())))
      .toSQL();
    expect(sql).toContain(" AND ");
  });

  test("return projection -> SELECT col AS alias", () => {
    const { sql } = select(Post).return((p) => ({ t: p.title, when: p.createdAt })).toSQL();
    expect(sql).toBe(
      `SELECT ${escapeIdent("title")} AS ${escapeIdent("t")}, ${escapeIdent("createdAt")} AS ${escapeIdent("when")} FROM ${escapeIdent("post")}`,
    );
  });
});

// --- decode-by-default (no server) ---------------------------------------------------------------
describe("@schemic/surrealdb/query — decode", () => {
  test("projection decodes through core's codec (datetime -> Date)", () => {
    const rows = select(Post)
      .return((p) => ({ when: p.createdAt }))
      .decodeRows([{ when: new DateTime(new Date("2020-01-02T03:04:05Z")) }]);
    expect(rows[0].when).toBeInstanceOf(Date);
    expect((rows[0].when as Date).getUTCFullYear()).toBe(2020);
  });

  test(".raw() skips decode (wire row passes through)", () => {
    const wire = new DateTime(new Date("2021-01-01T00:00:00Z"));
    const rows = select(Post)
      .raw()
      .decodeRows([{ id: "post:x", title: "t", createdAt: wire }]);
    expect((rows[0] as { createdAt: unknown }).createdAt).toBe(wire); // not decoded
  });
});
