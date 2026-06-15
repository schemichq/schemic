import { describe, expect, test } from "bun:test";
import { normalizeType } from "../../src/cli/struct";
import { emitSurqlType, parseSurqlType } from "../../src/driver/surql-type";

// Milestone 2 LOSSLESS proof: the SurrealQL type string <-> PortableType bridge must round-trip, so
// flipping diff equality to a structured deep-compare over PortableType can't produce false negatives
// (a missed migration). Two invariants: (1) emit∘parse reproduces the canonical SurrealQL spelling
// (== normalizeType), and (2) parse∘emit is identity on PortableType.

// Canonical kind strings (the form normalizeType produces) the engine actually emits/introspects.
const CANONICAL = [
  "string",
  "int",
  "float",
  "decimal",
  "number",
  "bool",
  "datetime",
  "duration",
  "uuid",
  "bytes",
  "any",
  "object",
  "null",
  "option<int>",
  "option<string>",
  "array<string>",
  "array<int, 3>",
  "set<string>",
  "set<float, 2>",
  "array<record<user>>",
  "array<object>",
  "record<user>",
  "record<account | user>",
  "geometry<point>",
  "geometry<polygon>",
  "'admin'",
  "'a' | 'b'",
  "null | string",
  "option<null | string>",
  "references<user>",
];

describe("surql-type bridge (Milestone 2 losslessness)", () => {
  test("emit∘parse reproduces the canonical SurrealQL spelling", () => {
    for (const kind of CANONICAL) {
      expect(emitSurqlType(parseSurqlType(kind))).toBe(kind);
    }
  });

  test("parse∘emit is identity on PortableType", () => {
    for (const kind of CANONICAL) {
      const p = parseSurqlType(kind);
      expect(parseSurqlType(emitSurqlType(p))).toEqual(p);
    }
  });

  test("agrees with normalizeType on non-canonical input (the canonicalizer's job)", () => {
    const cases: [string, string][] = [
      // union member ordering
      ["user | account", "account | user"],
      ["record<user | account>", "record<account | user>"],
      // a `none` union member folds into option<…>
      ["string | none", "option<string>"],
      // double-quoted literal -> single-quoted
      ['"admin"', "'admin'"],
      // nullable canonical form (null sorts first)
      ["string | null", "null | string"],
    ];
    for (const [input, canonical] of cases) {
      expect(emitSurqlType(parseSurqlType(input))).toBe(
        normalizeType(canonical),
      );
      // and the bridge's own output matches the engine's canonicalizer
      expect(emitSurqlType(parseSurqlType(input))).toBe(normalizeType(input));
    }
  });
});
