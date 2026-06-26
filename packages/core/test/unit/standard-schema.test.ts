import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { SFieldBase } from "../../src/authoring";

// A minimal concrete field — drivers subclass SFieldBase exactly this way (see SField / PgField).
// We only need a real instance to assert the forwarded `~standard` contract.
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

const field = new TestField(z.string(), {});

describe("Standard Schema", () => {
  test("a field exposes the `~standard` interface, forwarded from its schema", () => {
    const std = field["~standard"];
    expect(std).toBeDefined();
    expect(std.version).toBe(1);
    expect(std.vendor).toBe("zod");
    expect(typeof std.validate).toBe("function");
  });

  test("the field and its wrapped schema expose the same `~standard`", () => {
    expect(field["~standard"]).toBe(field.schema["~standard"]);
  });

  test("`~standard.validate` runs the field's validation (decode direction)", () => {
    const ok = field["~standard"].validate("hi");
    expect(ok).toEqual({ value: "hi" });

    const bad = field["~standard"].validate(123) as { issues?: unknown[] };
    expect(Array.isArray(bad.issues)).toBe(true);
  });

  test("the contract carries across chained wrappers (rebuild keeps it a field)", () => {
    const optional = field.optional();
    expect(optional["~standard"]).toBeDefined();
    expect(optional["~standard"].validate(undefined)).toEqual({ value: undefined });
  });
});
