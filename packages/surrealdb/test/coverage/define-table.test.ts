/**
 * SYNTAX COVERAGE — every permutation of a `DEFINE …` statement emits EXACTLY its pinned DDL.
 * `def` is real, tsc-checked authoring; `emitTable(def, options)` must equal the documented `ddl`.
 * Pure emit (no live DB); round-trip fidelity is covered by `test/parity/*`.
 */
import { describe, expect, test } from "bun:test";
import { allCoverage } from "../../coverage";
import { emitTable } from "../../src/ddl";

describe("DEFINE-statement syntax coverage", () => {
  for (const group of allCoverage) {
    describe(group.syntax, () => {
      for (const item of group.items) {
        test(item.title, () => {
          expect(emitTable(item.def, item.options)).toBe(item.ddl);
          expect(item.code.trim().length).toBeGreaterThan(0);
        });
      }
    });
  }

  test("every group has at least one permutation", () => {
    for (const group of allCoverage) {
      expect(group.items.length).toBeGreaterThan(0);
    }
  });
});
