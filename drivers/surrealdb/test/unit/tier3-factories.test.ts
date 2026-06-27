// Tier-3 Zod-parity factories: the long-tail `s.*` so a `z.` -> `s.` find-replace is a literal drop-in.
// Cross-driver names agreed with driver-dev-postgres; DDL mappings confirmed by core-dev.
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { emitTable } from "../../src/driver";
import { defineTable, s } from "../../src/index";

const line = (t: Parameters<typeof emitTable>[0], n: string) =>
  emitTable(t)
    .split("\n")
    .find((l) => l.includes(` ${n} `))
    ?.trim();

describe("Tier-3 string-format factories (app-side; DDL `string`)", () => {
  test("each emits a plain `string` column", () => {
    const T = defineTable("t", {
      id: s.string(),
      a: s.uuidv4(),
      b: s.uuidv6(),
      c: s.uuidv7(),
      d: s.httpUrl(),
      e: s.hostname(),
      f: s.hex(),
      g: s.mac(),
      h: s.hash("sha256"),
    });
    for (const k of ["a", "b", "c", "d", "e", "f", "g", "h"])
      expect(line(T, k)).toBe(`DEFINE FIELD ${k} ON TABLE t TYPE string;`);
  });

  test("they validate app-side", () => {
    expect(s.uuidv7().safeDecode("nope").success).toBe(false);
    expect(s.httpUrl().safeDecode("ftp://x").success).toBe(false);
    expect(s.httpUrl().safeDecode("https://x.co").success).toBe(true);
    expect(s.mac().safeDecode("00:11:22:33:44:55").success).toBe(true);
  });
});

describe("Tier-3 iso.* string formats (distinct from native datetime/duration codecs)", () => {
  test("nested s.iso.* emit `string`", () => {
    const T = defineTable("t", {
      id: s.string(),
      d: s.iso.date(),
      ti: s.iso.time(),
      dt: s.iso.datetime(),
      du: s.iso.duration(),
    });
    for (const k of ["d", "ti", "dt", "du"])
      expect(line(T, k)).toBe(`DEFINE FIELD ${k} ON TABLE t TYPE string;`);
    // native datetime stays the codec type (datetime), NOT string
    expect(
      line(defineTable("t", { id: s.string(), n: s.datetime() }), "n"),
    ).toBe("DEFINE FIELD n ON TABLE t TYPE datetime;");
  });
});

describe("Tier-3 strictObject / looseObject", () => {
  test("strictObject -> object, looseObject -> object FLEXIBLE, both composable", () => {
    const T = defineTable("t", {
      id: s.string(),
      so: s.strictObject({ a: s.string() }),
      lo: s.looseObject({ a: s.string() }),
    });
    expect(line(T, "so")).toBe("DEFINE FIELD so ON TABLE t TYPE object;");
    expect(line(T, "lo")).toBe(
      "DEFINE FIELD lo ON TABLE t TYPE object FLEXIBLE;",
    );
    expect(typeof s.looseObject({ a: s.string() }).extend).toBe("function");
  });
});

describe("Tier-3 structural: json / stringbool / codec", () => {
  test("json -> the recursive JSON union, validates any JSON", () => {
    const T = defineTable("t", { id: s.string(), j: s.json() });
    expect(line(T, "j")).toBe(
      "DEFINE FIELD j ON TABLE t TYPE string | number | bool | null | array<any> | object;",
    );
    expect(s.json().safeDecode({ a: [1, "x", null] }).success).toBe(true);
  });

  test("stringbool -> string wire (DDL), bool app", () => {
    const T = defineTable("t", { id: s.string(), b: s.stringbool() });
    expect(line(T, "b")).toBe("DEFINE FIELD b ON TABLE t TYPE string;");
    expect(s.stringbool().safeDecode("true").data).toBe(true);
    expect(s.stringbool().safeDecode("false").data).toBe(false);
  });

  test("codec(wire, app) -> DDL from the WIRE schema; decode/encode both ways", () => {
    const c = s.codec(z.string(), z.number(), {
      decode: Number,
      encode: String,
    });
    const T = defineTable("t", { id: s.string(), n: c });
    expect(line(T, "n")).toBe("DEFINE FIELD n ON TABLE t TYPE string;");
    expect(c.safeDecode("42").data).toBe(42);
    expect(c.safeEncode(42).data).toBe("42");
  });
});
