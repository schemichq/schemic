// @schemic/core/query toolkit: projection result-type inference (`Project`) + the runtime projection
// codec (`projectionSchema`/`decodeProjection`). The driver-owned builder composes these; here we drive
// them directly with a fake ref + a real Zod codec (string <-> Date) to prove decode actually transforms.

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  decodeProjection,
  type FieldRefBase,
  type Project,
  projectionSchema,
  type RefValue,
} from "../../src/query";

// A stand-in for a driver's FieldRef — carries its app type via the neutral FieldRefBase phantom.
interface FakeRef<T> extends FieldRefBase<T> {
  eq(v: T): boolean; // an "operator" — proves Project unwraps refs-with-methods, not maps their members
}

// --- type-level: Project + RefValue --------------------------------------------------------------
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;

type _refValue = Expect<Equal<RefValue<FakeRef<string>>, string>>;
// flat projection:
type _flat = Expect<
  Equal<Project<{ name: FakeRef<string>; at: FakeRef<Date> }>, { name: string; at: Date }>
>;
// nested projection (object literal inside the returned shape):
type _nested = Expect<
  Equal<
    Project<{ id: FakeRef<string>; meta: { title: FakeRef<string>; n: FakeRef<number> } }>,
    { id: string; meta: { title: string; n: number } }
  >
>;
// array projection:
type _arr = Expect<Equal<Project<FakeRef<number>[]>, number[]>>;

describe("@schemic/core/query — projection codec (runtime)", () => {
  // A real codec: wire string <-> app Date (decode must transform, not pass through).
  const dateCodec = z.codec(z.string(), z.date(), {
    decode: (s) => new Date(s),
    encode: (d) => d.toISOString(),
  });

  test("projectionSchema builds a z.object over the selected columns", () => {
    const schema = projectionSchema([
      { as: "title", schema: z.string() },
      { as: "at", schema: dateCodec },
    ]);
    const out = z.decode(schema, { title: "hi", at: "2020-01-02T03:04:05.000Z" });
    expect(out.title).toBe("hi");
    expect(out.at).toBeInstanceOf(Date);
    expect((out.at as Date).getUTCFullYear()).toBe(2020);
  });

  test("decodeProjection decodes each row through the ad-hoc codec", () => {
    const rows = [
      { title: "a", at: "2021-06-01T00:00:00.000Z" },
      { title: "b", at: "2022-06-01T00:00:00.000Z" },
    ];
    const decoded = decodeProjection<{ title: string; at: Date }>(
      [
        { as: "title", schema: z.string() },
        { as: "at", schema: dateCodec },
      ],
      rows,
    );
    expect(decoded).toHaveLength(2);
    expect(decoded[0].at).toBeInstanceOf(Date);
    expect(decoded[1].title).toBe("b");
  });

  test("nested projection: a column schema may itself be a z.object", () => {
    const decoded = decodeProjection<{ id: string; meta: { at: Date } }>(
      [
        { as: "id", schema: z.string() },
        { as: "meta", schema: z.object({ at: dateCodec }) },
      ],
      [{ id: "x", meta: { at: "2023-01-01T00:00:00.000Z" } }],
    );
    expect(decoded[0].meta.at).toBeInstanceOf(Date);
  });
});
