/**
 * The @schemic/surrealdb SYNTAX-COVERAGE suite — exhaustive, tsc-checked permutations of every
 * `DEFINE …` statement, each pinned to the exact DDL it emits. Internal completeness net (NOT the
 * public examples gallery). See `_kit.ts` and `test/coverage/*`.
 */
import type { CoverageGroup } from "./_kit";
import { defineTableCoverage } from "./define-table";

export type { CoverageGroup, CoverageItem } from "./_kit";

/** Every statement's coverage group. The coverage test iterates this. */
export const allCoverage: CoverageGroup[] = [defineTableCoverage];
