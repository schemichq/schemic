import { describe, expect, test } from "bun:test";
import { surql } from "surrealdb";
import { z } from "zod";
import { schemaStruct } from "../../src/cli/lower";
import { structuredSnapshot } from "../../src/cli/structure";
import { emitField, emitTable, renderPermissions } from "../../src/ddl";
import {
  defineRelation,
  defineTable,
  defineView,
  SField,
  type Shape,
  s,
  type TableDef,
} from "../../src/pure";

/** DDL for a single standalone field `x` on table `t`. */
const ddl = (field: SField, opts?: Parameters<typeof emitField>[3]) =>
  emitField("x", "t", field, opts);
/** The bare SurrealQL type a field infers to (for leaf-type assertions). */
const typeOf = (field: SField) => {
  const m = ddl(field).match(/TYPE (.+);$/);
  if (!m) throw new Error(`no TYPE in: ${ddl(field)}`);
  return m[1];
};

describe("leaf types", () => {
  test("primitives", () => {
    expect(typeOf(s.string())).toBe("string");
    expect(typeOf(s.number())).toBe("number");
    expect(typeOf(s.boolean())).toBe("bool");
    expect(typeOf(s.null())).toBe("null");
    expect(typeOf(s.any())).toBe("any");
    expect(typeOf(s.unknown())).toBe("any");
  });

  test("numbers discriminate int vs float by format", () => {
    expect(typeOf(s.int())).toBe("int");
    expect(typeOf(s.int32())).toBe("int");
    expect(typeOf(s.uint32())).toBe("int");
    expect(typeOf(s.bigint())).toBe("int");
    expect(typeOf(s.float())).toBe("float");
  });

  test("string formats all collapse to string (TYPE leaf)", () => {
    // Non-bakeable formats (no SurrealDB validator) stay a plain `string` with no ASSERT,
    // so the bare TYPE leaf is observable. (Bakeable ones carry an ASSERT — see below.)
    expect(typeOf(s.jwt())).toBe("string");
    expect(typeOf(s.cuid())).toBe("string");
    expect(typeOf(s.nanoid())).toBe("string");
    expect(typeOf(s.base64())).toBe("string");
  });

  test("surreal-native types", () => {
    expect(typeOf(s.datetime())).toBe("datetime");
    expect(typeOf(s.date())).toBe("datetime");
    expect(typeOf(s.uuid())).toBe("uuid");
    expect(typeOf(s.bytes())).toBe("bytes");
    expect(typeOf(s.duration())).toBe("duration");
    expect(typeOf(s.decimal())).toBe("decimal");
    expect(typeOf(s.file())).toBe("file");
    expect(typeOf(s.geometry())).toBe("geometry");
    expect(typeOf(s.geometry("point"))).toBe("geometry<point>");
  });

  test("record links", () => {
    expect(typeOf(s.recordId("user"))).toBe("record<user>");
    expect(typeOf(s.recordId(["user", "admin"]))).toBe("record<user | admin>");
    // No table -> a bare `record` (a link to ANY table); the table is optional in SurrealDB.
    expect(typeOf(s.recordId())).toBe("record");
  });
});

describe("wrappers", () => {
  test("optional -> option<>", () => {
    expect(typeOf(s.string().optional())).toBe("option<string>");
    expect(typeOf(s.int().optional())).toBe("option<int>");
  });

  test("zod .default() -> option<> (the value lives app-side, not in DDL)", () => {
    expect(ddl(s.string().default("x"))).toBe(
      "DEFINE FIELD x ON TABLE t TYPE option<string>;",
    );
  });

  test("nullable -> T | null", () => {
    expect(typeOf(s.string().nullable())).toBe("string | null");
  });

  test("nullish / .optional().nullable() / .nullable().optional() all -> option<T | null>", () => {
    expect(typeOf(s.string().nullish())).toBe("option<string | null>");
    expect(typeOf(s.string().optional().nullable())).toBe(
      "option<string | null>",
    );
    expect(typeOf(s.string().nullable().optional())).toBe(
      "option<string | null>",
    );
  });

  test("prefault -> option<> (app-side default); catch is transparent", () => {
    expect(typeOf(s.string().prefault("x"))).toBe("option<string>");
    expect(typeOf(s.string().catch("x"))).toBe("string");
  });

  test("array / set", () => {
    expect(typeOf(s.string().array())).toBe("array<string>");
    expect(typeOf(s.set(s.int()))).toBe("set<int>"); // set<T> is distinct from array<T>
  });

  test("optional/nullable any collapse to any (no invalid option<any>)", () => {
    // `any` already admits NONE/NULL, so `option<any>` is a SurrealQL parse error.
    expect(typeOf(s.any().optional())).toBe("any");
    expect(typeOf(s.any().nullable())).toBe("any");
    expect(typeOf(s.any().nullish())).toBe("any");
    expect(typeOf(s.unknown().optional())).toBe("any");
    expect(typeOf(s.any().array())).toBe("array<any>"); // still valid — unchanged
  });

  test("any absorbs every union member (`any | T` is invalid → any)", () => {
    expect(typeOf(s.union([s.string(), s.any()]))).toBe("any");
    expect(typeOf(s.union([s.any(), s.int()]))).toBe("any");
    expect(typeOf(s.union([s.string(), s.any()]).nullable())).toBe("any");
    expect(typeOf(s.union([s.string(), s.any()]).optional())).toBe("any");
    // a union with no `any` member is untouched
    expect(typeOf(s.union([s.string(), s.int()]))).toBe("string | int");
  });

  test("a `none`-ish union member (undefined/void) -> option<T>", () => {
    expect(typeOf(s.union([s.string(), z.undefined()]))).toBe("option<string>");
    expect(typeOf(s.union([z.void(), s.int()]))).toBe("option<int>");
    expect(typeOf(s.union([s.string(), s.int(), z.undefined()]))).toBe(
      "option<string | int>",
    );
    // any still wins over none
    expect(typeOf(s.union([s.any(), z.undefined()]))).toBe("any");
  });
});

describe("DB-side metadata clauses", () => {
  test("$default emits DEFAULT and keeps the type", () => {
    expect(ddl(s.string().$default(surql`"hi"`))).toBe(
      `DEFINE FIELD x ON TABLE t TYPE string DEFAULT "hi";`,
    );
  });

  test("$default strips a leading option<> (the column is always populated)", () => {
    expect(ddl(s.string().optional().$default(surql`"hi"`))).toBe(
      `DEFINE FIELD x ON TABLE t TYPE string DEFAULT "hi";`,
    );
  });

  test("$default accepts a plain value, rendered as a clean literal", () => {
    expect(ddl(s.string().$default("light"))).toBe(
      `DEFINE FIELD x ON TABLE t TYPE string DEFAULT "light";`,
    );
    expect(ddl(s.int().$default(0))).toBe(
      "DEFINE FIELD x ON TABLE t TYPE int DEFAULT 0;",
    );
    expect(ddl(s.boolean().$default(true))).toBe(
      "DEFINE FIELD x ON TABLE t TYPE bool DEFAULT true;",
    );
    expect(ddl(s.string().$defaultAlways("hi"))).toBe(
      `DEFINE FIELD x ON TABLE t TYPE string DEFAULT ALWAYS "hi";`,
    );
  });

  test("$defaultAlways -> DEFAULT ALWAYS", () => {
    expect(ddl(s.int().$defaultAlways(surql`0`))).toBe(
      "DEFINE FIELD x ON TABLE t TYPE int DEFAULT ALWAYS 0;",
    );
  });

  test("$value -> VALUE and strips option<>", () => {
    expect(
      ddl(s.string().optional().$value(surql`string::lowercase($value)`)),
    ).toBe(
      "DEFINE FIELD x ON TABLE t TYPE string VALUE string::lowercase($value);",
    );
  });

  test("$value with { optional: true } emits VALUE; type not wrapped in option<>", () => {
    expect(
      ddl(s.datetime().$value(surql`time::now()`, { optional: true })),
    ).toBe("DEFINE FIELD x ON TABLE t TYPE datetime VALUE time::now();");
  });

  test("$assert -> ASSERT", () => {
    expect(ddl(s.int().$assert(surql`$value >= 0`))).toBe(
      "DEFINE FIELD x ON TABLE t TYPE int ASSERT $value >= 0;",
    );
  });

  test("$readonly -> READONLY, $comment -> COMMENT", () => {
    expect(ddl(s.int().$readonly())).toBe(
      "DEFINE FIELD x ON TABLE t TYPE int READONLY;",
    );
    expect(ddl(s.string().$comment("a note"))).toBe(
      `DEFINE FIELD x ON TABLE t TYPE string COMMENT "a note";`,
    );
  });

  test("$internal -> PERMISSIONS NONE (field still emitted)", () => {
    expect(ddl(s.string().$internal())).toBe(
      "DEFINE FIELD x ON TABLE t TYPE string PERMISSIONS NONE;",
    );
  });

  test("clauses combine in a stable order", () => {
    expect(ddl(s.int().$default(surql`0`).$readonly().$comment("n"))).toBe(
      `DEFINE FIELD x ON TABLE t TYPE int DEFAULT 0 READONLY COMMENT "n";`,
    );
  });
});

describe("ASSERT generation", () => {
  test("format builders bake string::is_<fmt> by default (confirmed on v3.1.3)", () => {
    expect(ddl(s.email())).toBe(
      "DEFINE FIELD x ON TABLE t TYPE string ASSERT string::is_email($value);",
    );
    expect(ddl(s.url())).toBe(
      "DEFINE FIELD x ON TABLE t TYPE string ASSERT string::is_url($value);",
    );
    expect(ddl(s.ulid())).toBe(
      "DEFINE FIELD x ON TABLE t TYPE string ASSERT string::is_ulid($value);",
    );
    expect(ddl(s.ipv4())).toBe(
      "DEFINE FIELD x ON TABLE t TYPE string ASSERT string::is_ipv4($value);",
    );
    expect(ddl(s.ipv6())).toBe(
      "DEFINE FIELD x ON TABLE t TYPE string ASSERT string::is_ipv6($value);",
    );
  });

  test("formats without a SurrealDB validator stay assert-free (no fabricated regex)", () => {
    expect(ddl(s.jwt())).toBe("DEFINE FIELD x ON TABLE t TYPE string;");
    expect(ddl(s.cuid())).toBe("DEFINE FIELD x ON TABLE t TYPE string;");
    expect(ddl(s.nanoid())).toBe("DEFINE FIELD x ON TABLE t TYPE string;");
    expect(ddl(s.cidrv4())).toBe("DEFINE FIELD x ON TABLE t TYPE string;");
  });

  test("s.uuid() is the native uuid type with no assert", () => {
    expect(ddl(s.uuid())).toBe("DEFINE FIELD x ON TABLE t TYPE uuid;");
  });

  test("string $min/$max -> string::len bounds (AND-joined)", () => {
    expect(ddl(s.string().$min(1).$max(120))).toBe(
      "DEFINE FIELD x ON TABLE t TYPE string ASSERT string::len($value) >= 1 AND string::len($value) <= 120;",
    );
  });

  test("string $length -> string::len equality", () => {
    expect(ddl(s.string().$length(8))).toBe(
      "DEFINE FIELD x ON TABLE t TYPE string ASSERT string::len($value) == 8;",
    );
  });

  test("string $regex -> $value = /re/", () => {
    expect(ddl(s.string().$regex(/^[a-z]+$/))).toBe(
      "DEFINE FIELD x ON TABLE t TYPE string ASSERT $value = /^[a-z]+$/;",
    );
  });

  test("number $min/$max -> bare value bounds", () => {
    expect(ddl(s.number().$min(0).$max(10))).toBe(
      "DEFINE FIELD x ON TABLE t TYPE number ASSERT $value >= 0 AND $value <= 10;",
    );
  });

  test("number $gt/$gte/$lt/$lte map to the right operator", () => {
    expect(ddl(s.number().$gte(0).$lte(1))).toBe(
      "DEFINE FIELD x ON TABLE t TYPE number ASSERT $value >= 0 AND $value <= 1;",
    );
    expect(ddl(s.number().$gt(0).$lt(1))).toBe(
      "DEFINE FIELD x ON TABLE t TYPE number ASSERT $value > 0 AND $value < 1;",
    );
  });

  test("a $-constraint also applies the matching Zod check app-side", () => {
    const f = s.string().$min(2).$max(4);
    expect(f.schema.safeParse("ab").success).toBe(true);
    expect(f.schema.safeParse("a").success).toBe(false);
    expect(f.schema.safeParse("abcde").success).toBe(false);
    const n = s.number().$gte(0).$lte(1);
    expect(n.schema.safeParse(0.5).success).toBe(true);
    expect(n.schema.safeParse(2).success).toBe(false);
  });

  test("custom $assert(surql`…`) pushes the inlined expression", () => {
    expect(ddl(s.int().$assert(surql`$value % 2 == 0`))).toBe(
      "DEFINE FIELD x ON TABLE t TYPE int ASSERT $value % 2 == 0;",
    );
  });

  test("a builder + a $-constraint + a custom assert AND-join into one clause (deduped)", () => {
    // s.email() already baked string::is_email; the custom $assert repeats it -> deduped.
    const f = s.email().$max(254).$assert(surql`string::is_email($value)`);
    expect(ddl(f)).toBe(
      "DEFINE FIELD x ON TABLE t TYPE string ASSERT string::is_email($value) AND string::len($value) <= 254;",
    );
  });

  test("$assert() (no args) derives fragments from existing Zod checks", () => {
    // string: top-level format + chained length + regex.
    expect(
      ddl(
        new SField(
          z
            .email()
            .min(5)
            .regex(/@example\.com$/),
        ).$assert(),
      ),
    ).toBe(
      "DEFINE FIELD x ON TABLE t TYPE string ASSERT string::is_email($value) AND string::len($value) >= 5 AND $value = /@example\\.com$/;",
    );
    // number: inclusive vs exclusive bounds.
    expect(ddl(new SField(z.number().gte(0).lt(100)).$assert())).toBe(
      "DEFINE FIELD x ON TABLE t TYPE number ASSERT $value >= 0 AND $value < 100;",
    );
  });
});

describe("nested structures expand into sub-fields", () => {
  test("object -> path.key children", () => {
    const lines = ddl(s.object({ a: s.string(), b: s.int() })).split("\n");
    expect(lines).toEqual([
      "DEFINE FIELD x ON TABLE t TYPE object;",
      "DEFINE FIELD x.a ON TABLE t TYPE string;",
      "DEFINE FIELD x.b ON TABLE t TYPE int;",
    ]);
  });

  test("nested object keeps child $default metadata", () => {
    const out = ddl(s.object({ theme: s.string().$default(surql`"light"`) }));
    expect(out).toContain(
      `DEFINE FIELD x.theme ON TABLE t TYPE string DEFAULT "light";`,
    );
  });

  test("array of objects: element `.*` left to SurrealDB; only sub-fields emitted", () => {
    // SurrealDB auto-creates `x.*` from `array<object>`, so we emit only `x` and `x.*.a`.
    const lines = ddl(s.array(s.object({ a: s.string() }))).split("\n");
    expect(lines).toEqual([
      "DEFINE FIELD x ON TABLE t TYPE array<object>;",
      "DEFINE FIELD x.*.a ON TABLE t TYPE string;",
    ]);
  });

  test("array of scalars has no element sub-field", () => {
    expect(ddl(s.string().array())).toBe(
      "DEFINE FIELD x ON TABLE t TYPE array<string>;",
    );
  });

  test("FLEXIBLE bubbles from the element to the array field", () => {
    // SurrealDB stores `array<object> FLEXIBLE` on the FIELD (verified live), with the auto-created
    // `.*` element a plain `object` (re-defining `.*` errors "already exists"). So FLEXIBLE rides the
    // array field and the trivial element is skipped — `.flexible()` works on either spelling.
    expect(ddl(s.object({}).loose().array())).toBe(
      "DEFINE FIELD x ON TABLE t TYPE array<object> FLEXIBLE;",
    );
    expect(ddl(s.array(s.object({ a: s.string() })).flexible())).toEqual(
      [
        "DEFINE FIELD x ON TABLE t TYPE array<object> FLEXIBLE;",
        "DEFINE FIELD x.*.a ON TABLE t TYPE string;",
      ].join("\n"),
    );
  });

  test("record / map -> object with a .* value field (object `.*` is emitted)", () => {
    expect(ddl(s.record(z.string(), s.int())).split("\n")).toEqual([
      "DEFINE FIELD x ON TABLE t TYPE object;",
      "DEFINE FIELD x.* ON TABLE t TYPE int;",
    ]);
    expect(ddl(s.map(z.string(), s.string())).split("\n")).toEqual([
      "DEFINE FIELD x ON TABLE t TYPE object;",
      "DEFINE FIELD x.* ON TABLE t TYPE string;",
    ]);
  });

  test("loose object -> FLEXIBLE", () => {
    const out = ddl(new SField(z.looseObject({ a: z.string() })));
    expect(out).toContain("DEFINE FIELD x ON TABLE t TYPE object FLEXIBLE;");
  });

  test("intersection of objects merges children", () => {
    const out = ddl(
      s.intersection(s.object({ a: s.string() }), s.object({ b: s.int() })),
    );
    expect(out).toContain("DEFINE FIELD x ON TABLE t TYPE object;");
    expect(out).toContain("DEFINE FIELD x.a ON TABLE t TYPE string;");
    expect(out).toContain("DEFINE FIELD x.b ON TABLE t TYPE int;");
  });
});

describe("composite leaf types", () => {
  test("union", () => {
    expect(typeOf(s.union([s.string(), s.int()]))).toBe("string | int");
  });

  test("enum / literal", () => {
    expect(typeOf(s.enum(["admin", "member"]))).toBe(`"admin" | "member"`);
    expect(typeOf(s.literal("x"))).toBe(`"x"`);
    expect(typeOf(s.literal(42))).toBe("42");
    expect(typeOf(s.literal(true))).toBe("true");
  });

  test("tuple", () => {
    expect(typeOf(s.tuple([s.string(), s.int()]))).toBe("[string, int]");
  });

  test("nativeEnum (string and numeric)", () => {
    expect(typeOf(s.nativeEnum({ A: "a", B: "b" }))).toBe(`"a" | "b"`);
    enum Role {
      Guest = 0,
      Admin = 1,
    }
    expect(typeOf(s.nativeEnum(Role))).toBe("0 | 1");
  });
});

describe("edge branches", () => {
  test("a raw z.date() (no codec) -> datetime", () => {
    expect(typeOf(new SField(z.date()))).toBe("datetime");
  });

  test("an unregistered codec falls back to its wire (encoded) side", () => {
    const codec = z.codec(z.string(), z.number(), {
      decode: Number,
      encode: String,
    });
    expect(typeOf(new SField(codec))).toBe("string");
  });

  test("intersection of non-objects -> any", () => {
    expect(typeOf(s.intersection(s.string(), s.int()))).toBe("any");
  });

  test("variadic tuple -> generic array", () => {
    expect(typeOf(new SField(z.tuple([z.string()], z.number())))).toBe("array");
  });

  test("a $default with bindings is inlined into the DDL", () => {
    expect(ddl(s.int().$default(surql`${42}`))).toBe(
      "DEFINE FIELD x ON TABLE t TYPE int DEFAULT 42;",
    );
  });
});

describe("recursive types", () => {
  test("self-referential lazy terminates at `any`", () => {
    const node: SField = s.object({
      name: s.string(),
      next: s.lazy(() => node),
    });
    const out = ddl(node);
    expect(out).toContain("DEFINE FIELD x.next ON TABLE t TYPE object;");
    expect(out).toContain("DEFINE FIELD x.next.next ON TABLE t TYPE any;");
  });
});

describe("emitTable", () => {
  const User = defineTable("user", {
    id: z.string(),
    name: s.string(),
    role: s.enum(["admin", "member"]).$default(surql`"member"`),
    createdAt: s.datetime().$default(surql`time::now()`).$readonly(),
    settings: s.object({ theme: s.string().$default(surql`"light"`) }),
  }).comment("Users");

  test("table head: NORMAL, SCHEMAFULL, COMMENT", () => {
    const head = emitTable(User).split("\n")[0];
    expect(head).toBe(
      `DEFINE TABLE user TYPE NORMAL SCHEMAFULL COMMENT "Users";`,
    );
  });

  test("the implicit id field is not emitted", () => {
    expect(emitTable(User)).not.toContain("DEFINE FIELD id ");
  });

  test("fields are emitted with their metadata and nested children", () => {
    const out = emitTable(User);
    expect(out).toContain("DEFINE FIELD name ON TABLE user TYPE string;");
    expect(out).toContain(
      `DEFINE FIELD role ON TABLE user TYPE "admin" | "member" DEFAULT "member";`,
    );
    expect(out).toContain(
      "DEFINE FIELD createdAt ON TABLE user TYPE datetime DEFAULT time::now() READONLY;",
    );
    expect(out).toContain(
      `DEFINE FIELD settings.theme ON TABLE user TYPE string DEFAULT "light";`,
    );
  });

  test("an $internal() field is still emitted, with PERMISSIONS NONE", () => {
    const Account = defineTable("user", {
      email: s.email(),
      passhash: s.string().$internal(),
    });
    const out = emitTable(Account);
    expect(out).toContain(
      "DEFINE FIELD passhash ON TABLE user TYPE string PERMISSIONS NONE;",
    );
    expect(out).toContain(
      "DEFINE FIELD email ON TABLE user TYPE string ASSERT string::is_email($value);",
    );
  });

  test("schemaless / drop config", () => {
    expect(emitTable(User.schemaless())).toContain("SCHEMALESS");
    expect(emitTable(User.drop())).toContain("DROP");
  });

  test("typeAny -> TYPE ANY (default is TYPE NORMAL)", () => {
    expect(emitTable(User).split("\n")[0]).toContain("TYPE NORMAL");
    expect(emitTable(User.typeAny()).split("\n")[0]).toContain("TYPE ANY");
  });

  test("defineView().as() -> TYPE ANY SCHEMALESS AS <SELECT>, no DEFINE FIELD even with a shape", () => {
    const v = defineView("adults", { name: s.string(), age: s.number() }).as(
      surql`SELECT name, age FROM person WHERE age >= 18`,
    );
    const out = emitTable(v);
    expect(out).toBe(
      "DEFINE TABLE adults TYPE ANY SCHEMALESS AS SELECT name, age FROM person WHERE age >= 18;",
    );
    // a view is computed — the shape types rows but emits NO DEFINE FIELD (not even the implicit id).
    expect(out).not.toContain("DEFINE FIELD");
  });

  test("a view carries .comment()/.changefeed() onto the DEFINE TABLE head", () => {
    const v = defineView("v")
      .as(surql`SELECT * FROM person`)
      .comment("a view")
      .changefeed("1h");
    const head = emitTable(v).split("\n")[0];
    expect(head).toContain("AS SELECT * FROM person");
    expect(head).toContain('COMMENT "a view"');
    expect(head).toContain("CHANGEFEED 1h");
  });

  test("object .loose()/.flexible() -> FLEXIBLE; .strict()/default -> not", () => {
    expect(ddl(s.object({ a: s.string() }).loose())).toContain("FLEXIBLE");
    expect(ddl(s.object({ a: s.string() }).flexible())).toContain("FLEXIBLE");
    expect(ddl(s.object({ a: s.string() }).strict())).not.toContain("FLEXIBLE");
    expect(ddl(s.object({ a: s.string() }))).not.toContain("FLEXIBLE");
  });

  test("FLEXIBLE through array<object> and unions — on the field, both spellings", () => {
    // array<object>: FLEXIBLE rides the array field whether authored on the outer array or the inner
    // object (it descends/bubbles either way) — matches the DB's canonical form (verified live).
    expect(ddl(s.array(s.object({ a: s.string() })).flexible())).toContain(
      "TYPE array<object> FLEXIBLE",
    );
    expect(ddl(s.array(s.object({ a: s.string() }).flexible()))).toContain(
      "TYPE array<object> FLEXIBLE",
    );
    // union containing an object: FLEXIBLE on the field.
    expect(
      ddl(s.object({ a: s.string() }).flexible().or(s.string())),
    ).toContain("TYPE object | string FLEXIBLE");
    // option<object>: the wrapper preserves FLEXIBLE.
    expect(ddl(s.object({ a: s.string() }).flexible().optional())).toContain(
      "TYPE option<object> FLEXIBLE",
    );
    // a non-object array stays plain — nothing to flex.
    expect(ddl(s.array(s.string()))).not.toContain("FLEXIBLE");
  });

  test("FLEXIBLE objects keep extra keys on decode (validation matches the DB)", () => {
    const t = defineTable("t", {
      a: s.array(s.object({ x: s.string() })).flexible(),
      o: s.object({ x: s.string() }).flexible(),
    }).schemafull();
    // The static output type is `{ x: string }`, but FLEXIBLE objects keep arbitrary keys at runtime
    // (matching the DB) — assert against the looser shape.
    expect(t.fields.a.decode([{ x: "v", extra: 1 }] as never)).toEqual([
      { x: "v", extra: 1 },
    ] as never);
    expect(t.fields.o.decode({ x: "v", extra: 1 } as never)).toEqual({
      x: "v",
      extra: 1,
    } as never);
  });

  test("`.flexible()`/`.loose()`/`.strict()` no-op on non-object fields", () => {
    // The object-mode methods are unguarded (matching @schemic/postgres + enabling the SObjectField
    // subclass); on a non-object field `applyObjectMode` passes the schema through unchanged, so there
    // is no FLEXIBLE and the field emits exactly as without the call.
    const T = defineTable("t", {
      id: s.string(),
      a: s.string().flexible(),
      b: s.number().loose(),
      c: s.array(s.string()).strict(),
    });
    const line = (n: string) =>
      emitTable(T)
        .split("\n")
        .find((l) => l.includes(` ${n} `))
        ?.trim();
    expect(line("a")).toBe("DEFINE FIELD a ON TABLE t TYPE string;");
    expect(line("b")).toBe("DEFINE FIELD b ON TABLE t TYPE number;");
    expect(line("c")).toBe("DEFINE FIELD c ON TABLE t TYPE array<string>;");
  });

  test("existsPrefix: overwrite / ignore", () => {
    expect(emitTable(User, { exists: "overwrite" })).toContain(
      "DEFINE TABLE OVERWRITE user",
    );
    expect(emitTable(User, { exists: "ignore" })).toContain(
      "DEFINE TABLE IF NOT EXISTS user",
    );
    // applies to fields too
    expect(emitField("x", "t", s.string(), { exists: "overwrite" })).toBe(
      "DEFINE FIELD OVERWRITE x ON TABLE t TYPE string;",
    );
  });

  describe("relations", () => {
    const A = defineTable("user", { id: z.string() });
    const B = defineTable("post", { id: z.string() });
    const Tag = defineTable("tag", { id: z.string() });
    const Liked = defineRelation("liked", {
      strength: s.number().$assert(surql`$value >= 0`),
    })
      .from(A)
      .to(B);

    test("RELATION head with FROM/TO and skips in/out fields", () => {
      const out = emitTable(Liked);
      expect(out.split("\n")[0]).toBe(
        "DEFINE TABLE liked TYPE RELATION FROM user TO post SCHEMAFULL;",
      );
      expect(out).not.toContain("DEFINE FIELD in ");
      expect(out).not.toContain("DEFINE FIELD out ");
      expect(out).toContain(
        "DEFINE FIELD strength ON TABLE liked TYPE number ASSERT $value >= 0;",
      );
    });

    test("multi-endpoint relation -> FROM a | b", () => {
      const Multi = defineRelation("rel").from([A, Tag]).to(B);
      expect(emitTable(Multi as TableDef<string, Shape>).split("\n")[0]).toBe(
        "DEFINE TABLE rel TYPE RELATION FROM user | tag TO post SCHEMAFULL;",
      );
    });

    test("endpoints are optional — bare relation is `TYPE RELATION` (no FROM/TO)", () => {
      expect(emitTable(defineRelation("has", {})).split("\n")[0]).toBe(
        "DEFINE TABLE has TYPE RELATION SCHEMAFULL;",
      );
      // partial wiring: only `.from` set
      expect(emitTable(defineRelation("r").from(A)).split("\n")[0]).toBe(
        "DEFINE TABLE r TYPE RELATION FROM user SCHEMAFULL;",
      );
      // a bare relation is a usable table (passes the duck-typed checks)
      const bare = defineRelation("has", {});
      expect(bare.kind).toBe("relation");
      expect(typeof bare.record).toBe("function");
    });
  });
});

describe("PERMISSIONS", () => {
  /** The first line (table head) of a table's DDL. */
  const head = (t: TableDef<string, Shape>) => emitTable(t).split("\n")[0];
  const tbl = (perms: Parameters<TableDef<string, Shape>["permissions"]>[0]) =>
    defineTable("t", { name: s.string() }).permissions(perms);

  describe("renderPermissions algorithm (4 table ops)", () => {
    const ops = ["select", "create", "update", "delete"] as const;

    test("true -> FULL, false -> NONE", () => {
      expect(renderPermissions(true, ops)).toBe("PERMISSIONS FULL");
      expect(renderPermissions(false, ops)).toBe("PERMISSIONS NONE");
    });

    test("a BoundQuery is shared by all ops", () => {
      expect(renderPermissions(surql`owner = $auth.id`, ops)).toBe(
        "PERMISSIONS FOR select, create, update, delete WHERE owner = $auth.id",
      );
    });

    test("object with per-op rules emits one clause per op", () => {
      expect(
        renderPermissions(
          {
            select: surql`$auth.id != NONE`,
            create: false,
            update: surql`id = $auth.id`,
            delete: surql`id = $auth.id`,
          },
          ops,
        ),
      ).toBe(
        "PERMISSIONS FOR select WHERE $auth.id != NONE FOR create NONE FOR update, delete WHERE id = $auth.id",
      );
    });

    test("`same as X` reuses X's resolved rule and merges with it", () => {
      expect(
        renderPermissions({ select: surql`A`, update: "same as select" }, ops),
      ).toBe("PERMISSIONS FOR select, update WHERE A");
    });

    test("two identical BoundQuery exprs auto-merge into one FOR clause", () => {
      expect(
        renderPermissions(
          { select: surql`owner = $auth.id`, create: surql`owner = $auth.id` },
          ops,
        ),
      ).toBe("PERMISSIONS FOR select, create WHERE owner = $auth.id");
    });

    test("omitted ops emit nothing; an empty object emits no clause at all", () => {
      expect(renderPermissions({ select: surql`A` }, ops)).toBe(
        "PERMISSIONS FOR select WHERE A",
      );
      expect(renderPermissions({}, ops)).toBe("");
    });

    test("`same as <absent op>` is a clear runtime error", () => {
      expect(() =>
        renderPermissions({ select: "same as delete" }, ops),
      ).toThrow(/references op "delete", which is not in the spec/);
    });

    test("a `same as` reference cycle is a clear runtime error", () => {
      expect(() =>
        renderPermissions(
          { select: "same as update", update: "same as select" },
          ops,
        ),
      ).toThrow(/reference cycle/);
    });
  });

  describe("table wiring (folded into the single DEFINE TABLE head)", () => {
    test(".permissions(true) -> PERMISSIONS FULL on the head", () => {
      expect(head(tbl(true))).toBe(
        "DEFINE TABLE t TYPE NORMAL SCHEMAFULL PERMISSIONS FULL;",
      );
    });

    test(".permissions(false) -> PERMISSIONS NONE", () => {
      expect(head(tbl(false))).toBe(
        "DEFINE TABLE t TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;",
      );
    });

    test("a shared BoundQuery covers all four ops, after COMMENT", () => {
      const T = defineTable("t", { name: s.string() })
        .comment("notes")
        .permissions(surql`owner = $auth.id`);
      expect(head(T)).toBe(
        `DEFINE TABLE t TYPE NORMAL SCHEMAFULL COMMENT "notes" PERMISSIONS FOR select, create, update, delete WHERE owner = $auth.id;`,
      );
    });

    test("per-op object with `same as` merge", () => {
      const T = tbl({
        select: surql`$auth.id != NONE`,
        create: false,
        update: surql`id = $auth.id`,
        delete: "same as update",
      });
      expect(head(T)).toBe(
        "DEFINE TABLE t TYPE NORMAL SCHEMAFULL PERMISSIONS FOR select WHERE $auth.id != NONE FOR create NONE FOR update, delete WHERE id = $auth.id;",
      );
    });

    test("the CANONICAL (structured) emit collapses same-body ops too", () => {
      // Regression: the structured/canonical path (gen/diff/snapshot, via `canonicalPerms`) emitted
      // `FOR select WHERE … FOR update WHERE …` per-op, while the authoring emitter collapsed. Now both
      // collapse — matching SurrealDB's INFO form. (`delete NONE` is the table default, so it's omitted.)
      const T = defineTable("doc", { id: s.string() }).permissions({
        select: surql`$auth.id = id`,
        update: "same as select",
        create: true,
        delete: false,
      });
      const snap = structuredSnapshot(schemaStruct([T], []));
      const tableDdl = Object.values(snap.statements).find((st) =>
        st.ddl.startsWith("DEFINE TABLE doc"),
      )?.ddl;
      expect(tableDdl).toBe(
        "DEFINE TABLE doc TYPE NORMAL SCHEMAFULL PERMISSIONS FOR select, update WHERE $auth.id = id FOR create FULL;",
      );
    });
  });

  describe("field wiring (3 ops, no delete)", () => {
    test("blanket BoundQuery covers select, create, update only", () => {
      expect(ddl(s.string().$permissions(surql`published = true`))).toBe(
        "DEFINE FIELD x ON TABLE t TYPE string PERMISSIONS FOR select, create, update WHERE published = true;",
      );
    });

    test("an omitted field op stays unemitted (defaults to FULL in the DB)", () => {
      expect(
        ddl(
          s
            .string()
            .$permissions({ select: surql`published = true`, update: false }),
        ),
      ).toBe(
        "DEFINE FIELD x ON TABLE t TYPE string PERMISSIONS FOR select WHERE published = true FOR update NONE;",
      );
    });

    test("$permissions(false) / (true) -> NONE / FULL", () => {
      expect(ddl(s.string().$permissions(false))).toBe(
        "DEFINE FIELD x ON TABLE t TYPE string PERMISSIONS NONE;",
      );
      expect(ddl(s.string().$permissions(true))).toBe(
        "DEFINE FIELD x ON TABLE t TYPE string PERMISSIONS FULL;",
      );
    });

    test("an $internal() field still emits PERMISSIONS NONE (internal wins over $permissions)", () => {
      expect(
        ddl(s.string().$internal().$permissions({ select: surql`x` })),
      ).toBe("DEFINE FIELD x ON TABLE t TYPE string PERMISSIONS NONE;");
    });
  });
});
