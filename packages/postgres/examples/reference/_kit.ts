/**
 * Shared kit for the @schemic/postgres REFERENCE example suite.
 *
 * Each example pairs the TypeScript authoring (`s.*` / `defineTable`) with the exact PostgreSQL DDL it
 * emits. The `ddl` field is the GOLDEN — `test/examples/reference.test.ts` asserts `emit(defs) === ddl`
 * for every example, so the catalog can never drift from what the driver actually produces: change the
 * emit and the suite fails until the reference is updated.
 *
 * This is a pure-emit catalog (no live database) — it documents authoring -> DDL. Round-trip fidelity
 * (apply -> introspectAll -> diff = 0) is proven separately by the PGlite round-trip tests in
 * test/authoring.test.ts / test/kinds.test.ts.
 *
 * See packages/core/docs/EXAMPLE-COOKBOOK-CONVENTION.md for the standing per-driver convention.
 */
import { emitKinds } from "@schemic/core";
import type { PgTableDef } from "../../src/authoring";
import { registry, splitTables } from "../../src/kinds";
import { pgLower } from "../../src/lower";

/** A top-level schema object. Postgres authors only tables today (no standalone `define*` yet). */
export type Definable = PgTableDef;

/** One catalog entry: authoring + the PostgreSQL it emits (the asserted golden). */
export interface Example {
  /** The feature / syntax this entry demonstrates (also the test name). */
  title: string;
  /** Optional caveat — round-trip behavior, a known gap, or a `[~]`/`[ ]` note from COVERAGE.md. */
  note?: string;
  /** The authored schema objects, in emit order. */
  defs: Definable[];
  /** The exact PostgreSQL `defs` emit. Asserted by the reference test. */
  ddl: string;
}

/** A named group of examples (one source file in this folder). */
export interface ExampleGroup {
  /** The file these examples live in (for the test's `describe` label). */
  file: string;
  /** What the file covers. */
  about: string;
  examples: Example[];
}

/**
 * Emit a set of definables to PostgreSQL DDL — the driver's generic spine (lower -> split into kind
 * objects -> emit), the exact path the live driver uses, joined one statement per line. This is the
 * function the reference test asserts against, and a handy "what does this produce?" helper.
 */
export function emit(defs: Definable[]): string {
  return emitKinds(registry, splitTables(pgLower(defs))).join("\n");
}
