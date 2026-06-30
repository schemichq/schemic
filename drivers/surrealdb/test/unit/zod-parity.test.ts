// recordId(TableDef) links, the `.or()`/`.and()` combinators, and the native-Zod passthrough
// (refine/superRefine/check/overwrite/transform/pipe/brand/readonly/describe/meta) — s.* stays a
// drop-in for z.*, with DDL mapping to the wire/input type.

import { describe, expect, test } from "bun:test";
import { emitTable } from "../../src/driver";
import { defineTable, s } from "../../src/index";

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

describe("native Zod chain methods (Tier-2: app-side, DDL unchanged)", () => {
  // The bedrock invariant: non-$ chain methods validate APP-SIDE only and must NOT touch the DDL.
  // (The $-forms remain the DB-ASSERT channel — guarded below.)
  test("string formats/length/transforms emit NO DB clause", () => {
    const T = defineTable("t", {
      id: s.string(),
      a: s.string().email(),
      b: s.string().min(3).max(10),
      c: s.string().regex(/^x/).trim().toLowerCase(),
      n: s.int().gt(0).positive().multipleOf(2),
    });
    expect(field(T, "a")).toBe("DEFINE FIELD a ON TABLE t TYPE string;");
    expect(field(T, "b")).toBe("DEFINE FIELD b ON TABLE t TYPE string;");
    expect(field(T, "c")).toBe("DEFINE FIELD c ON TABLE t TYPE string;");
    expect(field(T, "n")).toBe("DEFINE FIELD n ON TABLE t TYPE int;");
  });

  test("the methods DO validate app-side (real Zod checks)", () => {
    expect(s.string().email().safeDecode("nope").success).toBe(false);
    expect(s.string().email().safeDecode("a@b.co").success).toBe(true);
    expect(s.string().min(3).safeDecode("ab").success).toBe(false);
    expect(s.int().gt(5).safeDecode(3).success).toBe(false);
    expect(s.int().positive().safeDecode(-1).success).toBe(false);
    // transform runs
    expect(s.string().trim().toLowerCase().decode("  AB ")).toBe("ab");
  });

  test("the $-forms STILL push the DB ASSERT (two-channel split intact)", () => {
    const T = defineTable("t", {
      id: s.string(),
      m: s.string().$min(3),
      g: s.int().$gt(0),
    });
    expect(field(T, "m")).toBe(
      "DEFINE FIELD m ON TABLE t TYPE string ASSERT string::len($value) >= 3;",
    );
    expect(field(T, "g")).toBe(
      "DEFINE FIELD g ON TABLE t TYPE int ASSERT $value > 0;",
    );
  });

  test("chain preserves SurrealMeta + flags (rebuild carries native forward)", () => {
    const T = defineTable("t", {
      id: s.string(),
      // $default (create-optional flag + DB DEFAULT) survives a following app-side .min()
      d: s.string().$default("x").min(1),
    });
    expect(field(T, "d")).toBe(
      'DEFINE FIELD d ON TABLE t TYPE string DEFAULT "x";',
    );
  });

  test("wrong base type throws a clear error", () => {
    // biome-ignore lint/suspicious/noExplicitAny: probing a runtime guard
    expect(() => (s.int() as any).email()).toThrow(
      "surrealdb: .email() is not available on this field's base type.",
    );
  });
});

describe("object composition (Tier-2: SObjectField, mirrors Zod's ZodObject)", () => {
  const lines = (
    t: Parameters<typeof emitTable>[0],
    prefix: string,
  ): string[] =>
    emitTable(t)
      .split("\n")
      .filter((l) => l.includes(` ${prefix}`))
      .map((l) => l.trim());

  const base = s.object({ a: s.string(), b: s.int().$default(0) });

  test(".extend() adds fields AND preserves nested $-clauses (registry maintained)", () => {
    const T = defineTable("t", {
      id: s.string(),
      o: base.extend({ c: s.boolean() }),
    });
    expect(lines(T, "o")).toEqual([
      "DEFINE FIELD o ON TABLE t TYPE object;",
      "DEFINE FIELD o.a ON TABLE t TYPE string;",
      "DEFINE FIELD o.b ON TABLE t TYPE int DEFAULT 0;", // $default survived .extend()
      "DEFINE FIELD o.c ON TABLE t TYPE bool;",
    ]);
  });

  test(".pick() / .omit() select keys", () => {
    const P = defineTable("t", { id: s.string(), o: base.pick({ a: true }) });
    const O = defineTable("t", { id: s.string(), o: base.omit({ a: true }) });
    expect(lines(P, "o")).toEqual([
      "DEFINE FIELD o ON TABLE t TYPE object;",
      "DEFINE FIELD o.a ON TABLE t TYPE string;",
    ]);
    expect(lines(O, "o")).toEqual([
      "DEFINE FIELD o ON TABLE t TYPE object;",
      "DEFINE FIELD o.b ON TABLE t TYPE int DEFAULT 0;",
    ]);
  });

  test(".partial() makes fields optional, keeping clauses", () => {
    const T = defineTable("t", { id: s.string(), o: base.partial() });
    expect(lines(T, "o")).toEqual([
      "DEFINE FIELD o ON TABLE t TYPE object;",
      "DEFINE FIELD o.a ON TABLE t TYPE option<string>;",
      "DEFINE FIELD o.b ON TABLE t TYPE int DEFAULT 0;",
    ]);
  });

  test("result stays composable + .flexible() composes (FLEXIBLE + extend)", () => {
    const T = defineTable("t", {
      id: s.string(),
      o: base.flexible().extend({ c: s.boolean() }),
    });
    expect(lines(T, "o")[0]).toBe(
      "DEFINE FIELD o ON TABLE t TYPE object FLEXIBLE;",
    );
    // still composable after a chain of ops
    expect(typeof base.extend({ c: s.boolean() }).pick).toBe("function");
  });

  test("app-side validation reflects the composed shape", () => {
    expect(
      base.extend({ c: s.boolean() }).safeDecode({ a: "x", b: 1 }).success,
    ).toBe(false);
    expect(
      base.extend({ c: s.boolean() }).safeDecode({ a: "x", b: 1, c: true })
        .success,
    ).toBe(true);
    expect(base.pick({ a: true }).safeDecode({ a: "x" }).success).toBe(true);
    expect(base.partial().safeDecode({}).success).toBe(true);
  });
});

describe("date / enum / array Zod parity (Tier-2 last edges)", () => {
  const line = (t: Parameters<typeof emitTable>[0], n: string) =>
    emitTable(t)
      .split("\n")
      .find((l) => l.includes(` ${n} `))
      ?.trim();

  test("date .min/.max validate app-side (codec-aware) with the column unchanged", () => {
    const min = new Date(Date.UTC(2030, 0, 1));
    const f = s.datetime().min(min);
    // get a real surreal DateTime by round-tripping through the codec (its own DateTime class)
    const enc = (d: Date) =>
      (s.datetime().schema as { encode: (x: Date) => unknown }).encode(d);
    expect(f.safeDecode(enc(new Date(Date.UTC(2031, 0, 1)))).success).toBe(
      true,
    );
    expect(f.safeDecode(enc(new Date(Date.UTC(2020, 0, 1)))).success).toBe(
      false,
    );
    // app-side only — DDL stays `datetime` (the $-channel would be the DB form, but dates have none)
    const T = defineTable("t", {
      id: s.string(),
      w: s
        .datetime()
        .min(min)
        .max(new Date(Date.UTC(2040, 0, 1))),
    });
    expect(line(T, "w")).toBe("DEFINE FIELD w ON TABLE t TYPE datetime;");
  });

  test("enum .exclude/.extract derive a narrower enum (type + DDL narrow)", () => {
    const role = s.enum(["admin", "user", "guest"]);
    expect(role.exclude(["guest"]).safeDecode("guest").success).toBe(false);
    expect(role.exclude(["guest"]).safeDecode("admin").success).toBe(true);
    expect(role.extract(["admin"]).safeDecode("user").success).toBe(false);
    const T = defineTable("t", {
      id: s.string(),
      ex: role.exclude(["guest"]),
      ex2: role.extract(["admin"]),
    });
    expect(line(T, "ex")).toBe(
      'DEFINE FIELD ex ON TABLE t TYPE "admin" | "user";',
    );
    expect(line(T, "ex2")).toBe('DEFINE FIELD ex2 ON TABLE t TYPE "admin";');
  });

  test("array .min/.max/.length/.nonempty validate app-side, column unchanged", () => {
    expect(s.array(s.string()).min(2).safeDecode(["a"]).success).toBe(false);
    expect(s.array(s.string()).nonempty().safeDecode([]).success).toBe(false);
    expect(s.array(s.string()).length(2).safeDecode(["a", "b"]).success).toBe(
      true,
    );
    const T = defineTable("t", {
      id: s.string(),
      a: s.array(s.string()).min(2),
    });
    expect(line(T, "a")).toBe("DEFINE FIELD a ON TABLE t TYPE array<string>;");
  });
});
