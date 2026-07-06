// A shared DRIVER CONFORMANCE suite — the runtime contract a `@schemic/<driver>` must satisfy, asserted
// with `bun:test`. Each driver runs it against its own authoring surface:
//
//   import { describeDriverConformance } from "@schemic/core/testing";
//   import { defineTable, s, surrealDriver } from "@schemic/surrealdb";
//   describeDriverConformance({ name: "surrealdb", s, driver: surrealDriver, defineEntity: defineTable });
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
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type * as z from "zod";
import { type Driver, driverNames, getDriver } from "./driver/driver";
import { emitKinds, type KindRegistry, lowerSchema } from "./kind";

/**
 * The driver's authoring namespace (`s`) — a bag of field builders, some NESTED (e.g.
 * `s.iso.{date,time,datetime,duration}`). Intentionally loose: the suite duck-types fields and
 * enforces the real contract at RUNTIME, not via this type (see the header note), so a precise
 * "function-or-nested-namespace" shape would only fight the internal `s.<key>()` calls for no gain.
 */
// biome-ignore lint/suspicious/noExplicitAny: a driver's `s` is dialect-specific + may nest; runtime-duck-typed.
type Authoring = Record<string, any>;

export interface DriverConformanceOptions {
  /** The driver's registry name (e.g. `"surrealdb"`, `"postgres"`). */
  name: string;
  /** The driver's authoring namespace — the `s` each package exports. */
  s: Authoring;
  /** The driver under test (already registered by importing its package). */
  driver: Driver<unknown>;
  /**
   * Authors the driver's primary fielded definable — a table, collection, node-type, … — from a name
   * and a field shape. Used to lower a probe object through the pipeline. Drivers pass their own
   * `define*` for this (e.g. `defineEntity: defineTable`); the suite stays shape-agnostic.
   */
  // biome-ignore lint/suspicious/noExplicitAny: dialect-specific definable/shape types.
  defineEntity: (name: string, shape: Record<string, any>) => any;
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
  const { name, s, driver, defineEntity } = opts;

  describe(`driver conformance: ${name}`, () => {
    describe("Driver contract", () => {
      test("is registered under its name", () => {
        expect(driverNames()).toContain(name);
        expect(getDriver(name)).toBe(driver);
        expect(driver.name).toBe(name);
      });

      test("exposes a kind registry + the schema/execution ops", () => {
        // Schema ops are generic over `registry`; the driver provides the fan-out + execution.
        expect(driver.registry).toBeDefined();
        expect(typeof driver.registry.entries).toBe("function");
        expect(driver.registry.names().length).toBeGreaterThan(0);
        for (const op of [
          "explode",
          "introspectAll",
          "connect",
          "apply",
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

    describe("lowering (drop-in fields → kind registry)", () => {
      test("an entity of drop-in fields explodes + lowers + emits, carrying every field", () => {
        const shape: Record<string, unknown> = {};
        for (const { key, build } of DROP_INS) shape[`f_${key}`] = build(s);
        const entity = defineEntity("schemic_conformance_probe", shape);

        // explode (authoring -> kinded definables) -> lowerSchema -> portable objects.
        const portable = lowerSchema(
          driver.registry,
          driver.explode([entity], []),
        );
        // Kind-agnostic: the probe lowers to at least one object (its kind is the driver's own —
        // `table`, `collection`, …); the per-field check below is what proves lowering is faithful.
        expect(portable.length).toBeGreaterThan(0);

        // The portable shape is the driver's own, but the emitted DDL is generic: every drop-in
        // field name must appear in it (lowering + emit carried it through).
        const ddl = emitKinds(driver.registry, portable).join("\n");
        expect(ddl.length).toBeGreaterThan(0);
        for (const { key } of DROP_INS) {
          expect(ddl).toContain(`f_${key}`);
        }
      });
    });
  });
}

// --- Coverage reconcile -------------------------------------------------------------------------
//
// The shared, driver-AGNOSTIC guard that keeps a driver's `docs/COVERAGE.md` (prose discipline) honest
// against reality — closing the "done-vs-todo list silently drifts" gap. A driver declares its coverage
// as data (a KIND manifest + a FEATURE manifest) and this reconciles it against the LIVE facts: the
// neutral `registry.names()`/`.entries()` enumeration (so the registered-kind side CAN'T drift from the
// code) and the actual test titles (so a feature can't be marked done without a real test). The
// ENFORCEMENT lives here, in ONE place — a driver supplies only its manifest, so a fix propagates to
// every driver instead of drifting across three copies.
//
// DELIBERATELY NOT checked: "every kind defines `canonical()`". `KindEngine.canonical` is OPTIONAL by
// contract (it defaults to `emit(portable).join("\n")`), so a kind whose `emit` already IS its canonical
// form correctly omits it — requiring it here would false-fail a conformant driver. A driver that wants
// the stricter "all MY kinds define an explicit canonical" invariant can assert it in a local test.

/** Coverage status, mirroring the `docs/COVERAGE.md` checkbox: full round-trip / partial / not done. */
export type CoverageStatus = "x" | "~" | " ";

/** A registered KIND and the round-trip status it claims. */
export interface KindCoverage {
  name: string;
  status: CoverageStatus;
  note?: string;
}

/** A finer-grained FEATURE within a kind, and (when done) the test that proves it. */
export interface FeatureCoverage {
  key: string;
  kind: string;
  status: CoverageStatus;
  /** A substring of the test title that exercises this feature — REQUIRED when status is `x`. */
  coveredBy?: string;
  note?: string;
}

/** The live inputs a reconcile runs against (the pure form — no `bun:test`, no filesystem). */
export interface CoverageReconcileInput {
  registry: KindRegistry;
  kinds: KindCoverage[];
  features: FeatureCoverage[];
  /** Concatenated source of the driver's `*.test.ts` — real test titles are extracted from it. */
  testSrc: string;
}

/** One named check and the assertions it failed (empty = passed). */
export interface CoverageCheck {
  name: string;
  failures: string[];
}

/** The reconcile outcome: per-check breakdown + a flattened failure list for a single-assert test. */
export interface CoverageReconcileResult {
  checks: CoverageCheck[];
  failures: string[];
}

/**
 * Extract the titles of the REAL, non-skipped `test(...)`/`it(...)` calls from concatenated test source.
 * Matching against actual titles (rather than a raw `source.includes`) means a mention in a comment or an
 * unrelated string literal can't count as coverage, and a `.skip`/`.todo` test can't satisfy a done claim.
 */
function extractTestTitles(src: string): string[] {
  const re =
    /\b(?:test|it)(\.[\w.]+)?\s*\(\s*(["'`])((?:\\.|(?!\2)[\s\S])*?)\2/g;
  const titles: string[] = [];
  for (const m of src.matchAll(re)) {
    const modifier = m[1] ?? "";
    if (/\.(?:skip|todo)\b/.test(modifier)) continue;
    titles.push(m[3]);
  }
  return titles;
}

/**
 * Reconcile a driver's declared coverage against the live registry + tests. PURE — returns a per-check
 * breakdown; {@link describeCoverageReconcile} is the `bun:test` shell around it. See the section header
 * for what is (and deliberately isn't) checked.
 */
export function reconcileCoverage(
  input: CoverageReconcileInput,
): CoverageReconcileResult {
  const { registry, kinds, features, testSrc } = input;
  const registered = new Set(registry.names());
  const checks: CoverageCheck[] = [];

  // 1. Registered kinds EXACTLY equal the manifest, both directions — the neutral registry is the LHS,
  //    so registering a kind without listing it (or vice versa) fails by construction.
  const declared = new Set(kinds.map((k) => k.name));
  const kindsFailures: string[] = [];
  for (const name of registered)
    if (!declared.has(name))
      kindsFailures.push(
        `kind "${name}" is registered but missing from the manifest`,
      );
  for (const name of declared)
    if (!registered.has(name))
      kindsFailures.push(
        `kind "${name}" is in the manifest but not registered`,
      );
  checks.push({
    name: "registered kinds match the manifest",
    failures: kindsFailures,
  });

  // 2. Every feature references a registered kind (referential integrity).
  checks.push({
    name: "every feature maps to a registered kind",
    failures: features
      .filter((f) => !registered.has(f.kind))
      .map((f) => `feature "${f.key}" -> unknown kind "${f.kind}"`),
  });

  // 3. Every DONE feature names a covering test that actually exists.
  const titles = extractTestTitles(testSrc);
  const coverFailures: string[] = [];
  for (const f of features) {
    if (f.status !== "x") continue;
    if (!f.coveredBy) {
      coverFailures.push(
        `feature "${f.key}" is [x] but declares no coveredBy test`,
      );
      continue;
    }
    if (!titles.some((t) => t.includes(f.coveredBy as string)))
      coverFailures.push(
        `feature "${f.key}" coveredBy "${f.coveredBy}" — no matching (non-skipped) test title`,
      );
  }
  checks.push({
    name: "every [x] feature names a covering test",
    failures: coverFailures,
  });

  // 4. No duplicate feature keys / kind entries (hygiene — a dup silently hides one side).
  checks.push({
    name: "no duplicate feature keys",
    failures: duplicates(
      features.map((f) => f.key),
      "feature key",
    ),
  });
  checks.push({
    name: "no duplicate kind entries",
    failures: duplicates(
      kinds.map((k) => k.name),
      "kind entry",
    ),
  });

  return { checks, failures: checks.flatMap((c) => c.failures) };
}

/** Names appearing more than once, as failure messages. */
function duplicates(names: string[], label: string): string[] {
  const seen = new Set<string>();
  const dup: string[] = [];
  for (const n of names) {
    if (seen.has(n)) dup.push(`duplicate ${label} "${n}"`);
    seen.add(n);
  }
  return dup;
}

/** Options for the `bun:test` reconcile shell. Supply `testDir` (read for you) OR a pre-read `testSrc`. */
export interface CoverageReconcileOptions {
  /** Label for the describe block (typically the driver name). */
  name?: string;
  registry: KindRegistry;
  kinds: KindCoverage[];
  features: FeatureCoverage[];
  /** The dir holding this driver's `*.test.ts`; the helper concatenates them to prove test coverage. */
  testDir?: string;
  /** Pre-read test source, if you'd rather gather it yourself (alternative to `testDir`). */
  testSrc?: string;
}

/**
 * Register the coverage reconcile as a `bun:test` block — one named `test(...)` per check, so CI reads
 * granularly. A driver calls this from a single `*.test.ts` with its manifest + `testDir`:
 *
 *   import { describeCoverageReconcile } from "@schemic/core/testing";
 *   import { registry } from "../src/kinds";
 *   import { KIND_MANIFEST, FEATURE_MANIFEST } from "./coverage-manifest";
 *   describeCoverageReconcile({ name: "sqlite", registry, kinds: KIND_MANIFEST,
 *     features: FEATURE_MANIFEST, testDir: import.meta.dir });
 */
export function describeCoverageReconcile(
  opts: CoverageReconcileOptions,
): void {
  const { name, registry, kinds, features } = opts;
  const testSrc =
    opts.testSrc ?? (opts.testDir ? readTestSrc(opts.testDir) : "");
  describe(name ? `coverage reconcile: ${name}` : "coverage reconcile", () => {
    for (const check of reconcileCoverage({
      registry,
      kinds,
      features,
      testSrc,
    }).checks) {
      test(check.name, () => {
        expect(check.failures).toEqual([]);
      });
    }
  });
}

/** Concatenate every `*.test.ts` in `dir` (the source the covering-test check scans). */
function readTestSrc(dir: string): string {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
}
