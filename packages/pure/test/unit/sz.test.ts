import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { objectFieldsRegistry, SField, surrealTypeRegistry, sz } from "../../src/pure";

const defType = (f: SField) => (f.schema._zod.def as { type: string }).type;
const fmt = (f: SField) => (f.schema._zod.def as { format?: string }).format;

describe("primitive builders map to the right Zod def", () => {
  test("scalars", () => {
    expect(defType(sz.string())).toBe("string");
    expect(defType(sz.number())).toBe("number");
    expect(defType(sz.boolean())).toBe("boolean");
    expect(defType(sz.null())).toBe("null");
    expect(defType(sz.any())).toBe("any");
    expect(defType(sz.unknown())).toBe("unknown");
    expect(defType(sz.bigint())).toBe("bigint");
  });

  test("number formats", () => {
    expect(fmt(sz.int())).toContain("int");
    expect(fmt(sz.int32())).toContain("int");
    expect(fmt(sz.uint32())).toContain("int");
    expect(fmt(sz.float())).toContain("float");
  });
});

describe("native types register their SurrealQL type", () => {
  test("registry entries", () => {
    expect(surrealTypeRegistry.get(sz.datetime().schema)).toBe("datetime");
    expect(surrealTypeRegistry.get(sz.date().schema)).toBe("datetime");
    expect(surrealTypeRegistry.get(sz.uuid().schema)).toBe("uuid");
    expect(surrealTypeRegistry.get(sz.bytes().schema)).toBe("bytes");
    expect(surrealTypeRegistry.get(sz.duration().schema)).toBe("duration");
    expect(surrealTypeRegistry.get(sz.decimal().schema)).toBe("decimal");
    expect(surrealTypeRegistry.get(sz.file().schema)).toBe("file");
    expect(surrealTypeRegistry.get(sz.geometry().schema)).toBe("geometry");
    expect(surrealTypeRegistry.get(sz.geometry("point").schema)).toBe("geometry<point>");
    expect(surrealTypeRegistry.get(sz.recordId("user").schema)).toBe("record<user>");
  });
});

describe("composite builders", () => {
  test("object registers its SField shape", () => {
    const o = sz.object({ a: sz.string() });
    expect(defType(o)).toBe("object");
    expect(objectFieldsRegistry.get(o.schema)).toBeDefined();
  });

  test("collections and wrappers", () => {
    expect(defType(sz.array(sz.string()))).toBe("array");
    expect(defType(sz.set(sz.string()))).toBe("set");
    expect(defType(sz.record(z.string(), sz.string()))).toBe("record");
    expect(defType(sz.map(z.string(), sz.string()))).toBe("map");
    expect(defType(sz.union([sz.string(), sz.int()]))).toBe("union");
    expect(defType(sz.tuple([sz.string()]))).toBe("tuple");
    expect(defType(sz.intersection(sz.object({ a: sz.string() }), sz.object({ b: sz.int() })))).toBe(
      "intersection",
    );
    expect(defType(sz.enum(["a", "b"]))).toBe("enum");
    expect(defType(sz.literal("x"))).toBe("literal");
    expect(defType(sz.nativeEnum({ A: "a" }))).toBe("enum");
    expect(defType(sz.lazy(() => sz.string()))).toBe("lazy");
    expect(
      defType(
        sz.discriminatedUnion("kind", [
          sz.object({ kind: sz.literal("a"), a: sz.string() }),
          sz.object({ kind: sz.literal("b"), b: sz.int() }),
        ]),
      ),
    ).toBe("union");
  });

  test("every string-format builder yields a string SField", () => {
    const builders = [
      sz.url(),
      sz.guid(),
      sz.nanoid(),
      sz.cuid(),
      sz.cuid2(),
      sz.ulid(),
      sz.xid(),
      sz.ksuid(),
      sz.ipv4(),
      sz.ipv6(),
      sz.cidrv4(),
      sz.cidrv6(),
      sz.base64(),
      sz.base64url(),
      sz.e164(),
      sz.jwt(),
      sz.emoji(),
    ];
    for (const b of builders) {
      expect(b).toBeInstanceOf(SField);
      expect(defType(b)).toBe("string");
    }
  });

  test("optional / nullable wrappers", () => {
    expect(defType(sz.optional(sz.string()))).toBe("optional");
    expect(defType(sz.nullable(sz.string()))).toBe("nullable");
    expect(defType(sz.string().optional())).toBe("optional");
    expect(defType(sz.string().nullable())).toBe("nullable");
  });

  test("accepts raw Zod schemas as element/value types", () => {
    const a = sz.array(z.string());
    expect(a).toBeInstanceOf(SField);
    expect(defType(a)).toBe("array");
  });
});

describe("field method wrappers", () => {
  test("prefault fills an absent value (and validates it)", () => {
    const f = sz.int().prefault(5);
    expect(f).toBeInstanceOf(SField);
    expect(defType(f)).toBe("prefault");
    expect(z.decode(f.schema, undefined as never)).toBe(5);
  });

  test("catch recovers from a parse failure", () => {
    const f = sz.int().catch(9);
    expect(defType(f)).toBe("catch");
    expect(z.decode(f.schema, "nope" as never)).toBe(9);
  });

  test("nullish accepts null, undefined, and the value", () => {
    const f = sz.string().nullish();
    expect(defType(f)).toBe("optional");
    expect(f.schema.safeParse(null).success).toBe(true);
    expect(f.schema.safeParse(undefined).success).toBe(true);
    expect(f.schema.safeParse("x").success).toBe(true);
  });

  test("unwrap peels one wrapper and keeps surreal metadata", () => {
    expect(defType(sz.string().optional().unwrap())).toBe("string");
    expect(defType(sz.int().default(1).unwrap())).toBe("number");
    expect(defType(sz.string().array().unwrap())).toBe("string");
    expect(sz.string().$comment("c").optional().unwrap().surreal.comment).toBe("c");
  });
});
