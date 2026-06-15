// recordId(TableDef) links, the `.or()`/`.and()` combinators, and the native-Zod passthrough
// (refine/superRefine/check/overwrite/transform/pipe/brand/readonly/describe/meta) — s.* stays a
// drop-in for z.*, with DDL mapping to the wire/input type.

import { describe, expect, test } from "bun:test";
import { defineTable, emitTable, s } from "../../src/index";

const field = (t: Parameters<typeof emitTable>[0], name: string): string =>
  emitTable(t)
    .split("\n")
    .find((l) => l.includes(` ${name} `))
    ?.trim()
    .replace(/ PERMISSIONS.*/, "") ?? "";

const User = defineTable("user", { id: s.string(), name: s.string() });
const Service = defineTable("service", { id: s.string() });
const Post = defineTable("post", { id: s.string() });

describe("recordId accepts table defs (no hardcoded names)", () => {
  test("single def, def array, and string back-compat", () => {
    const T = defineTable("t", {
      id: s.string(),
      a: s.recordId(User),
      b: s.recordId([User, Service]),
      c: s.recordId("user"),
      d: s.recordId(["user", "service"]),
    });
    expect(field(T, "a")).toBe("DEFINE FIELD a ON TABLE t TYPE record<user>;");
    expect(field(T, "b")).toBe(
      "DEFINE FIELD b ON TABLE t TYPE record<user | service>;",
    );
    expect(field(T, "c")).toBe("DEFINE FIELD c ON TABLE t TYPE record<user>;");
    expect(field(T, "d")).toBe(
      "DEFINE FIELD d ON TABLE t TYPE record<user | service>;",
    );
  });
});

describe(".or() / .and() combinators (Zod parity)", () => {
  test(".or() unions; record links compose via .record().or()", () => {
    const T = defineTable("t", {
      id: s.string(),
      u: s.string().or(s.int()),
      link: User.record().or(Post.record()),
    });
    expect(field(T, "u")).toBe("DEFINE FIELD u ON TABLE t TYPE string | int;");
    expect(field(T, "link")).toBe(
      "DEFINE FIELD link ON TABLE t TYPE record<user> | record<post>;",
    );
  });

  test(".or() composes with optional()", () => {
    const T = defineTable("t", {
      id: s.string(),
      m: s.recordId([User, Service]).optional(),
    });
    expect(field(T, "m")).toBe(
      "DEFINE FIELD m ON TABLE t TYPE option<record<user | service>>;",
    );
  });
});

describe("native Zod passthrough", () => {
  test("refine validates at runtime; the field's DDL type is unchanged", () => {
    const name = s.string().refine((s) => s.length >= 2, "too short");
    expect(name.safeDecode("ab").success).toBe(true);
    expect(name.safeDecode("a").success).toBe(false);
    const T = defineTable("t", { id: s.string(), name });
    expect(field(T, "name")).toBe("DEFINE FIELD name ON TABLE t TYPE string;");
  });

  test("a format's baked ASSERT survives a refine", () => {
    const T = defineTable("t", {
      id: s.string(),
      email: s.email().refine((s) => s.includes("@")),
    });
    expect(field(T, "email")).toBe(
      "DEFINE FIELD email ON TABLE t TYPE string ASSERT string::is_email($value);",
    );
  });

  test("transform changes the decoded value; DDL keeps the wire type", () => {
    const up = s.string().transform((s) => s.toUpperCase());
    expect(up.decode("hi")).toBe("HI");
    const T = defineTable("t", { id: s.string(), up });
    expect(field(T, "up")).toBe("DEFINE FIELD up ON TABLE t TYPE string;");
  });

  test("brand / readonly are app-side only — DDL maps to the base type", () => {
    const T = defineTable("t", {
      id: s.string(),
      tag: s.string().brand("Tag"),
      ro: s.int().readonly(),
    });
    expect(field(T, "tag")).toBe("DEFINE FIELD tag ON TABLE t TYPE string;");
    expect(field(T, "ro")).toBe("DEFINE FIELD ro ON TABLE t TYPE int;");
  });
});
