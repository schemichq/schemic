import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { SFieldBase } from "../../src/authoring";

// Minimal concrete field — drivers subclass SFieldBase exactly this way (SField / PgField).
class TestField<
  S extends z.ZodType = z.ZodType,
  F extends string = never,
> extends SFieldBase<S, F, Record<string, never>> {
  protected rebuild<S2 extends z.ZodType, F2 extends string>(
    schema: S2,
    native: Record<string, never>,
  ): TestField<S2, F2> {
    return new TestField<S2, F2>(schema, native);
  }
  protected blank(): Record<string, never> {
    return {};
  }
}
const field = <S extends z.ZodType>(s: S) => new TestField(s, {});

describe("SFieldBase Zod parity (shared-base methods)", () => {
  test("isOptional / isNullable reflect the inner schema", () => {
    expect(field(z.string()).isOptional()).toBe(false);
    expect(field(z.string().optional()).isOptional()).toBe(true);
    expect(field(z.string().nullable()).isNullable()).toBe(true);
  });

  test("nonoptional strips an optional", () => {
    expect(field(z.string().optional()).nonoptional().isOptional()).toBe(false);
  });

  test("exactOptional yields a field", () => {
    expect(field(z.string()).exactOptional().schema).toBeDefined();
  });

  test("description getter reads back .describe()", () => {
    expect(field(z.string().describe("a name")).description).toBe("a name");
    expect(field(z.string()).description).toBeUndefined();
  });

  test("toJSONSchema delegates to z.toJSONSchema", () => {
    const js = field(z.string()).toJSONSchema() as { type?: string };
    expect(js.type).toBe("string");
  });

  test("register adds the inner schema to a registry and chains", () => {
    const reg = z.registry<{ title: string }>();
    const f = field(z.string());
    expect(f.register(reg, { title: "T" })).toBe(f); // chainable
    expect(reg.has(f.schema)).toBe(true);
  });

  test("spa is the async safe-parse (decode direction)", async () => {
    expect(await field(z.string()).spa("hi")).toEqual({
      success: true,
      data: "hi",
    });
  });
});
