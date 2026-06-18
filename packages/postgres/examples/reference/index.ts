/**
 * The @schemic/postgres REFERENCE example suite — a verified cookbook of authoring -> PostgreSQL DDL.
 *
 * Every entry pairs `s.*` / `defineTable` authoring with the EXACT DDL it emits; `test/examples/reference.test.ts`
 * asserts `emit(defs) === ddl` for all of them, so this catalog can never drift from the driver. Browse
 * the per-area files for quick reference; run the test to verify everything still emits as documented.
 *
 * See packages/core/docs/EXAMPLE-COOKBOOK-CONVENTION.md for the standing per-driver convention.
 */
import type { ExampleGroup } from "./_kit";
import { group as tables } from "./01-tables";
import { group as fieldTypes } from "./02-field-types";
import { group as fieldClauses } from "./03-field-clauses";
import { group as indexes } from "./04-indexes";
import { group as constraints } from "./05-constraints";
import { group as relations } from "./06-relations";
import { group as escapeHatch } from "./07-escape-hatch";

export type { Definable, Example, ExampleGroup } from "./_kit";
export { emit } from "./_kit";

/** Every example group, in reading order. The reference test iterates this. */
export const allGroups: ExampleGroup[] = [
  tables,
  fieldTypes,
  fieldClauses,
  indexes,
  constraints,
  relations,
  escapeHatch,
];
