/**
 * Shared kit for the @schemic/postgres REFERENCE example suite.
 *
 * Each example pairs the TypeScript authoring (`s.*` / `defineTable`) with the exact PostgreSQL DDL it
 * emits. Authoring is held as a STRING (`code`) and `defs` is DERIVED from it by `evalDefs` — so the
 * snippet shown to users, the objects emitted, and the golden DDL can never disagree (per the
 * convention's "keep code honest" SHOULD). `test/examples/reference.test.ts` asserts
 * `emit(defs) === ddl` for every example — i.e. `emit(evalDefs(code)) === ddl` — so the catalog can
 * never drift from what the driver actually produces: change the emit and the suite fails until the
 * reference is updated.
 *
 * This is a pure-emit catalog (no live database) — it documents authoring -> DDL. Round-trip fidelity
 * (apply -> introspectAll -> diff = 0) is proven separately by the PGlite round-trip tests in
 * test/authoring.test.ts / test/kinds.test.ts.
 *
 * See packages/core/docs/EXAMPLE-COOKBOOK-CONVENTION.md for the standing per-driver convention.
 */
import { emitKinds } from "@schemic/core";
import * as z from "zod";
import {
  defineTable,
  PgField,
  type PgTableDef,
  s,
  sqlExpr,
} from "../../src/authoring";
import { registry, splitTables } from "../../src/kinds";
import { pgLower } from "../../src/lower";

/** A top-level schema object. Postgres authors only tables today (no standalone `define*` yet). */
export type Definable = PgTableDef;

/** One catalog entry: authoring source (`code`) + the PostgreSQL it emits (the asserted golden). */
export interface Example {
  /** The feature / syntax this entry demonstrates (also the test name). */
  title: string;
  /** Optional caveat — round-trip behavior, a known gap, or a `[~]`/`[ ]` note from COVERAGE.md. */
  note?: string;
  /** The authoring source as text (the verbatim `s.*` / `defineTable` snippet) — rendered by docs/gallery. */
  code: string;
  /** The authored schema objects, derived from `code` (see {@link evalDefs}), in emit order. */
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

/** A demo App-side value type, in scope for `code` snippets that show the codec escape hatch. */
export class Money {
  constructor(public cents: number) {}
}

/**
 * Evaluate an authoring `code` snippet to its `Definable[]` — the single source of truth for an entry.
 * The snippet is a self-contained expression returning a def or an array of defs, evaluated with the pg
 * authoring surface (`s`, `defineTable`, `sqlExpr`, `PgField`, `z`) and the demo `Money` type in scope.
 * Deriving `defs` from `code` (rather than maintaining both by hand) is what keeps code/defs/ddl honest.
 */
export function evalDefs(code: string): Definable[] {
  // `new Function` (not eval) over trusted in-repo cookbook snippets, never user input.
  const fn = new Function(
    "s",
    "defineTable",
    "sqlExpr",
    "PgField",
    "z",
    "Money",
    `"use strict"; return (${code});`,
  );
  const out = fn(s, defineTable, sqlExpr, PgField, z, Money);
  return Array.isArray(out) ? out : [out];
}

/** Build an {@link Example}, deriving `defs` from `code` so the snippet and the emitted objects agree. */
export function example(e: {
  title: string;
  note?: string;
  code: string;
  ddl: string;
}): Example {
  return {
    title: e.title,
    ...(e.note ? { note: e.note } : {}),
    code: e.code,
    defs: evalDefs(e.code),
    ddl: e.ddl,
  };
}

/**
 * Emit a set of definables to PostgreSQL DDL — the driver's generic spine (lower -> split into kind
 * objects -> emit), the exact path the live driver uses, joined one statement per line. This is the
 * function the reference test asserts against, and a handy "what does this produce?" helper.
 */
export function emit(defs: Definable[]): string {
  return emitKinds(registry, splitTables(pgLower(defs))).join("\n");
}
