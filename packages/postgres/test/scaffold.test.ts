import { describe, expect, test } from "bun:test";
import { defineSeed, postgresDriver } from "../src/index";

// `schemic new <kind> <name>` calls Driver.scaffoldEntity(kind, name) -> the starter module text.
const scaffold = (kind: string, name: string): string => {
  const fn = postgresDriver.scaffoldEntity;
  if (!fn) throw new Error("postgres driver has no scaffoldEntity");
  return fn(kind, name);
};

describe("scaffoldEntity", () => {
  test("table -> a defineTable starter module", () => {
    const out = scaffold("table", "user");
    expect(out).toContain(
      'import { defineTable, s, sqlExpr } from "@schemic/postgres";',
    );
    expect(out).toContain('export const user = defineTable("user", {');
    expect(out).toContain(
      'createdAt: s.timestamptz().$default(sqlExpr("now()"))',
    );
  });

  test("table name -> a valid JS identifier for the export", () => {
    expect(scaffold("table", "blog-post")).toContain(
      'export const blogPost = defineTable("blog-post", {',
    );
    // snake_case stays a valid identifier; the table-name string is verbatim.
    expect(scaffold("table", "audit_log")).toContain(
      'export const audit_log = defineTable("audit_log", {',
    );
    // digit-led names get a leading underscore so the export is valid TS.
    expect(scaffold("table", "2fa")).toContain(
      'export const _2fa = defineTable("2fa", {',
    );
  });

  test("index/constraint are table-internal -> throw with guidance", () => {
    expect(() => scaffold("index", "x")).toThrow(/isn't a standalone entity/);
    expect(() => scaffold("constraint", "x")).toThrow(
      /isn't a standalone entity/,
    );
  });

  test("unknown kind -> throws", () => {
    expect(() => scaffold("view", "x")).toThrow(/unknown entity kind "view"/);
  });
});

describe("seed scaffold (defineSeed + ctx)", () => {
  const files = postgresDriver.initScaffold?.() ?? {};

  test("defineSeed is an identity wrapper (typing only)", () => {
    const fn = async () => {};
    expect(defineSeed(fn)).toBe(fn);
  });

  test("scaffolds database/seed/index.ts using defineSeed, no seeds.d.ts", () => {
    expect(Object.keys(files)).toContain("database/seed/index.ts");
    expect(Object.keys(files)).not.toContain("database/seed/seeds.d.ts");
    const seed = files["database/seed/index.ts"] ?? "";
    expect(seed).toContain('import { defineSeed } from "@schemic/postgres";');
    expect(seed).toContain("export default defineSeed(async (db, ctx) =>");
    expect(seed).toContain('ctx.file("schema.sql")');
    expect(seed).not.toContain('with { type: "text" }');
  });
});
