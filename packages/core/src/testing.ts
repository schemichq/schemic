// A shared DRIVER CONFORMANCE suite — the runtime contract a `@schemic/<driver>` must satisfy, asserted
// with `bun:test`. Each driver runs it against its own authoring surface:
//
//   import { describeDriverConformance } from "@schemic/core/testing";
//   import { defineTable, s, surrealDriver } from "@schemic/surrealdb";
//   describeDriverConformance({ name: "surrealdb", s, driver: surrealDriver, defineTable });
//
// WHY a test, not a type: the zod drop-in builders (`s.string()` = `new <D>Field(z.string())`) are
// mechanically identical across drivers, but TypeScript has NO higher-kinded types, so a generic core
// factory can't preserve each driver's field type (it collapses to the base, dropping `$`-methods).
// Each driver therefore hand-authors its drop-ins, and "`s` is a Zod SUPERSET" is enforceable only at
// runtime. This suite is that enforcement.
//
// It DUCK-TYPES fields (a field is "something with a `.schema` that is a Zod type") rather than using
// `instanceof SFieldBase` — a driver may extend its own copy of the base, so identity checks are unsafe.

import { describe, expect, test } from "bun:test";
import type * as z from "zod";
import { type Driver, driverNames, getDriver } from "./driver/driver";

/** The driver's authoring namespace (`s`) — a bag of field builders. Loosely typed (cross-driver). */
// biome-ignore lint/suspicious/noExplicitAny: a driver's `s` is dialect-specific; the suite is generic.
type Authoring = Record<string, (...args: any[]) => unknown>;

export interface DriverConformanceOptions {
  /** The driver's registry name (e.g. `"surrealdb"`, `"postgres"`). */
  name: string;
  /** The driver's authoring namespace — the `s` each package exports. */
  s: Authoring;
  /** The driver under test (already registered by importing its package). */
  driver: Driver<unknown>;
  /** The driver's `defineTable(name, shape)` — used to lower a probe table. */
  // biome-ignore lint/suspicious/noExplicitAny: dialect-specific table/shape types.
  defineTable: (name: string, shape: Record<string, any>) => any;
}

/**
 * The canonical zod DROP-IN set every driver's `s` MUST expose — the structural Zod builders that make
 * a `@schemic/<driver>` a drop-in for `z`. Each maps to the DB's natural representation (a driver may
 * also offer richer native aliases, e.g. `text`/`varchar` alongside `string`). `object`/`array` nest a
 * `literal` (present everywhere) so a missing `string` doesn't cascade into their tests.
 */
const DROP_INS: { key: string; build: (s: Authoring) => unknown }[] = [
  { key: "string", build: (s) => s.string() },
  { key: "number", build: (s) => s.number() },
  { key: "boolean", build: (s) => s.boolean() },
  { key: "date", build: (s) => s.date() },
  { key: "literal", build: (s) => s.literal("a") },
  { key: "enum", build: (s) => s.enum(["a", "b"]) },
  { key: "object", build: (s) => s.object({ inner: s.literal("a") }) },
  { key: "array", build: (s) => s.array(s.literal("a")) },
];

/** Value pairs that prove a scalar drop-in really carries the right Zod schema (unambiguous scalars only). */
const SCALAR_CHECKS: { key: string; valid: unknown; invalid: unknown }[] = [
  { key: "string", valid: "hello", invalid: 123 },
  { key: "number", valid: 123, invalid: "hello" },
  { key: "boolean", valid: true, invalid: "hello" },
];

/** Duck-typed: a field exposes a Zod `.schema`; a raw Zod type IS the schema. Throws if neither. */
function toSchema(v: unknown): z.ZodType {
  const field = v as { schema?: unknown } | null;
  if (field && isZod(field.schema)) return field.schema as z.ZodType;
  if (isZod(v)) return v as z.ZodType;
  throw new Error("expected a field (with a `.schema` Zod type) or a Zod type");
}

function isZod(v: unknown): boolean {
  return !!v && typeof (v as { safeParse?: unknown }).safeParse === "function";
}

/** Is `v` a driver field (has a `.schema` that is a Zod type)? */
function isField(v: unknown): boolean {
  return isZod((v as { schema?: unknown } | null)?.schema);
}

/**
 * Assert a `@schemic/<driver>` conforms to the Schemic driver contract: the Driver is registered with
 * the IR pipeline + execution ops, and its `s` is a Zod-drop-in SUPERSET (the canonical drop-in set is
 * present, carries the right schemas, composes through wrappers, and lowers to the portable IR).
 */
export function describeDriverConformance(
  opts: DriverConformanceOptions,
): void {
  const { name, s, driver, defineTable } = opts;

  describe(`driver conformance: ${name}`, () => {
    describe("Driver contract", () => {
      test("is registered under its name", () => {
        expect(driverNames()).toContain(name);
        expect(getDriver(name)).toBe(driver);
        expect(driver.name).toBe(name);
      });

      test("implements the IR pipeline + execution ops", () => {
        for (const op of [
          "lower",
          "emit",
          "remove",
          "overwrite",
          "introspect",
          "normalize",
          "equal",
          "diff",
          "connect",
          "close",
        ] as const) {
          expect(typeof driver[op]).toBe("function");
        }
      });
    });

    describe("zod drop-in surface (s.* is a Zod superset)", () => {
      for (const { key, build } of DROP_INS) {
        test(`s.${key}() exists and returns a field`, () => {
          expect(typeof s[key]).toBe("function");
          const field = build(s);
          expect(isField(field)).toBe(true);
        });
      }

      for (const { key, valid, invalid } of SCALAR_CHECKS) {
        test(`s.${key}() carries a "${key}" Zod schema`, () => {
          const schema = toSchema(s[key]());
          expect(schema.safeParse(valid).success).toBe(true);
          expect(schema.safeParse(invalid).success).toBe(false);
        });
      }
    });

    describe("Zod-clean codecs + wrappers", () => {
      test("decode/encode delegate to the inner Zod schema", () => {
        const field = s.string() as {
          decode: (v: unknown) => unknown;
          encode: (v: unknown) => unknown;
        };
        expect(field.decode("hi")).toBe("hi");
        expect(field.encode("hi")).toBe("hi");
      });

      test("wrappers preserve field-ness (optional/array compose)", () => {
        const field = s.string() as {
          optional: () => unknown;
          array: () => unknown;
        };
        expect(isField(field.optional())).toBe(true);
        expect(isField(field.array())).toBe(true);
      });
    });

    describe("lowering (drop-in fields → portable IR)", () => {
      test("a table of drop-in fields lowers + emits without throwing", () => {
        const shape: Record<string, unknown> = {};
        for (const { key, build } of DROP_INS) shape[`f_${key}`] = build(s);
        const table = defineTable("schemic_conformance_probe", shape);

        const portable = driver.lower([table], []);
        expect(portable.tables).toHaveLength(1);
        // Every drop-in field made it into the lowered table (objects may fold to one native column).
        const fieldNames = new Set(
          portable.tables[0].fields.map((f) => f.name),
        );
        for (const { key } of DROP_INS) {
          expect(fieldNames.has(`f_${key}`)).toBe(true);
        }

        const statements = driver.emit(portable);
        expect(statements.length).toBeGreaterThan(0);
      });
    });
  });
}
