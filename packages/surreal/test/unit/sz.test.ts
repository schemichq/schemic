import { describe, expect, test } from "bun:test";
import { RecordId } from "surrealdb";
import { z } from "zod";
import { emitStatements, fieldType } from "../../src/ddl";
import {
  defineTable,
  objectFieldsRegistry,
  RecordIdField,
  SField,
  s,
  surrealTypeRegistry,
} from "../../src/pure";

const defType = (f: SField) => (f.schema._zod.def as { type: string }).type;
const fmt = (f: SField) => (f.schema._zod.def as { format?: string }).format;

describe("primitive builders map to the right Zod def", () => {
  test("scalars", () => {
    expect(defType(s.string())).toBe("string");
    expect(defType(s.number())).toBe("number");
    expect(defType(s.boolean())).toBe("boolean");
    expect(defType(s.null())).toBe("null");
    expect(defType(s.any())).toBe("any");
    expect(defType(s.unknown())).toBe("unknown");
    expect(defType(s.bigint())).toBe("bigint");
  });

  test("number formats", () => {
    expect(fmt(s.int())).toContain("int");
    expect(fmt(s.int32())).toContain("int");
    expect(fmt(s.uint32())).toContain("int");
    expect(fmt(s.float())).toContain("float");
  });
});

describe("native types register their SurrealQL type", () => {
  test("registry entries", () => {
    expect(surrealTypeRegistry.get(s.datetime().schema)).toBe("datetime");
    expect(surrealTypeRegistry.get(s.date().schema)).toBe("datetime");
    expect(surrealTypeRegistry.get(s.uuid().schema)).toBe("uuid");
    expect(surrealTypeRegistry.get(s.bytes().schema)).toBe("bytes");
    expect(surrealTypeRegistry.get(s.duration().schema)).toBe("duration");
    expect(surrealTypeRegistry.get(s.decimal().schema)).toBe("decimal");
    expect(surrealTypeRegistry.get(s.file().schema)).toBe("file");
    expect(surrealTypeRegistry.get(s.geometry().schema)).toBe("geometry");
    expect(surrealTypeRegistry.get(s.geometry("point").schema)).toBe(
      "geometry<point>",
    );
    expect(surrealTypeRegistry.get(s.recordId("user").schema)).toBe(
      "record<user>",
    );
  });
});

describe("coerce builders: same SurrealQL type, looser input", () => {
  test("coerce.* maps to the same field type as the non-coerced builder", () => {
    expect(fieldType(s.coerce.string())).toBe(fieldType(s.string()));
    expect(fieldType(s.coerce.number())).toBe(fieldType(s.number()));
    expect(fieldType(s.coerce.boolean())).toBe(fieldType(s.boolean()));
    expect(fieldType(s.coerce.bigint())).toBe(fieldType(s.bigint()));
    expect(fieldType(s.coerce.date())).toBe("datetime");
    expect(surrealTypeRegistry.get(s.coerce.date().schema)).toBe("datetime");
  });

  test("coercion runs on the input side (string -> number, 1 -> boolean)", () => {
    expect(s.coerce.number().schema.parse("42")).toBe(42);
    expect(s.coerce.boolean().schema.parse(1)).toBe(true);
  });
});

describe("non-Surreal types: present for z.* parity, rejected as table fields", () => {
  test("the builders exist and are SFields", () => {
    const builders = [
      s.symbol(),
      s.undefined(),
      s.void(),
      s.never(),
      s.nan(),
      s.custom(),
      s.instanceof(Date),
      s.promise(s.string()),
    ];
    for (const f of builders) expect(f).toBeInstanceOf(SField);
  });

  test("using one as a table field throws a clear error", () => {
    expect(() => fieldType(s.symbol())).toThrow(/no SurrealQL type/);
    expect(() => fieldType(s.never())).toThrow(/no SurrealQL type/);
    expect(() => fieldType(s.custom())).toThrow(/no SurrealQL type/);
    expect(() => fieldType(s.instanceof(Date))).toThrow(/no SurrealQL type/);
    expect(() =>
      emitStatements(
        // @ts-expect-error - s.symbol() is also rejected at the type level
        defineTable("t", { x: s.symbol() }),
      ),
    ).toThrow(/no SurrealQL type/);
  });
});

describe("nullish == optional + nullable", () => {
  test("yields option<T | null>", () => {
    expect(fieldType(s.nullish(s.string()))).toBe(
      fieldType(s.string().optional().nullable()),
    );
  });
});

describe("$surreal — declare a DDL type + optional codec", () => {
  class Money {
    constructor(readonly cents: number) {}
    toString() {
      return String(this.cents);
    }
  }

  test("codec form: DDL derived from the wire field, round-trips, accepted in a table", () => {
    const price = s.instanceof(Money).$surreal(s.string(), {
      encode: (m) => m.toString(),
      decode: (s) => new Money(Number(s)),
    });
    expect(fieldType(price)).toBe("string");
    expect(price.encode(new Money(199))).toBe("199");
    expect(price.decode("199")).toBeInstanceOf(Money);
    // accepted as a table field now that it knows how to serialize:
    expect(() =>
      emitStatements(defineTable("st", { id: z.string(), price })),
    ).not.toThrow();
  });

  test("the wire field can be any s.* type (its DDL is derived)", () => {
    const tags = s.custom<Set<string>>().$surreal(s.array(s.string()), {
      encode: (set) => [...set],
      decode: (arr) => new Set(arr),
    });
    expect(fieldType(tags)).toBe("array<string>");
  });

  test("identity form: app value stored as the wire type (no conversion)", () => {
    expect(fieldType(s.custom<string>().$surreal(s.string()))).toBe("string");
  });
});

describe("composite builders", () => {
  test("object registers its SField shape", () => {
    const o = s.object({ a: s.string() });
    expect(defType(o)).toBe("object");
    expect(objectFieldsRegistry.get(o.schema)).toBeDefined();
  });

  test("collections and wrappers", () => {
    expect(defType(s.array(s.string()))).toBe("array");
    expect(defType(s.set(s.string()))).toBe("set");
    expect(defType(s.record(z.string(), s.string()))).toBe("record");
    expect(defType(s.map(z.string(), s.string()))).toBe("map");
    expect(defType(s.union([s.string(), s.int()]))).toBe("union");
    expect(defType(s.tuple([s.string()]))).toBe("tuple");
    expect(
      defType(
        s.intersection(s.object({ a: s.string() }), s.object({ b: s.int() })),
      ),
    ).toBe("intersection");
    expect(defType(s.enum(["a", "b"]))).toBe("enum");
    expect(defType(s.literal("x"))).toBe("literal");
    expect(defType(s.nativeEnum({ A: "a" }))).toBe("enum");
    expect(defType(s.lazy(() => s.string()))).toBe("lazy");
    expect(
      defType(
        s.discriminatedUnion("kind", [
          s.object({ kind: s.literal("a"), a: s.string() }),
          s.object({ kind: s.literal("b"), b: s.int() }),
        ]),
      ),
    ).toBe("union");
  });

  test("every string-format builder yields a string SField", () => {
    const builders = [
      s.url(),
      s.guid(),
      s.nanoid(),
      s.cuid(),
      s.cuid2(),
      s.ulid(),
      s.xid(),
      s.ksuid(),
      s.ipv4(),
      s.ipv6(),
      s.cidrv4(),
      s.cidrv6(),
      s.base64(),
      s.base64url(),
      s.e164(),
      s.jwt(),
      s.emoji(),
    ];
    for (const b of builders) {
      expect(b).toBeInstanceOf(SField);
      expect(defType(b)).toBe("string");
    }
  });

  test("optional / nullable wrappers", () => {
    expect(defType(s.optional(s.string()))).toBe("optional");
    expect(defType(s.nullable(s.string()))).toBe("nullable");
    expect(defType(s.string().optional())).toBe("optional");
    expect(defType(s.string().nullable())).toBe("nullable");
  });

  test("accepts raw Zod schemas as element/value types", () => {
    const a = s.array(z.string());
    expect(a).toBeInstanceOf(SField);
    expect(defType(a)).toBe("array");
  });
});

describe("field method wrappers", () => {
  test("prefault fills an absent value (and validates it)", () => {
    const f = s.int().prefault(5);
    expect(f).toBeInstanceOf(SField);
    expect(defType(f)).toBe("prefault");
    expect(z.decode(f.schema, undefined as never)).toBe(5);
  });

  test("catch recovers from a parse failure", () => {
    const f = s.int().catch(9);
    expect(defType(f)).toBe("catch");
    expect(z.decode(f.schema, "nope" as never)).toBe(9);
  });

  test("nullish accepts null, undefined, and the value", () => {
    const f = s.string().nullish();
    expect(defType(f)).toBe("optional");
    expect(f.schema.safeParse(null).success).toBe(true);
    expect(f.schema.safeParse(undefined).success).toBe(true);
    expect(f.schema.safeParse("x").success).toBe(true);
  });

  test("unwrap peels one wrapper and keeps surreal metadata", () => {
    expect(defType(s.string().optional().unwrap())).toBe("string");
    expect(defType(s.int().default(1).unwrap())).toBe("number");
    expect(defType(s.string().array().unwrap())).toBe("string");
    expect(s.string().$comment("c").optional().unwrap().surreal.comment).toBe(
      "c",
    );
  });
});

describe("RecordIdField stays a RecordIdField across `this`-returning passthroughs (B1 soundness)", () => {
  test("refine/check keep the RecordIdField runtime methods (.for/.type) — no crash", () => {
    const f = s.recordId("user").refine(() => true);
    // The `this`-returning base passthroughs rebuild via RecordIdField.rebuild, so `f` is a real
    // RecordIdField at runtime (pre-fix it was a plain SField and `.for` crashed).
    expect(f).toBeInstanceOf(RecordIdField);
    const id = f.for("ada");
    expect(id).toBeInstanceOf(RecordId);
    expect(id.table.name).toBe("user");
    // chaining .type() (another RecordIdField method) also still works
    expect(s.recordId("user").check().type(z.string())).toBeInstanceOf(
      RecordIdField,
    );
  });

  test("the refinement is preserved (not silently dropped by rebuild)", () => {
    const f = s.recordId("user").refine((r) => r.id === "ada", "must be ada");
    expect(f.safeDecode(new RecordId("user", "ada")).success).toBe(true);
    expect(f.safeDecode(new RecordId("user", "bob")).success).toBe(false);
  });
});
