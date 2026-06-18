/**
 * Verifies the @schemic/postgres REFERENCE example cookbook (`examples/reference/*`): every catalog
 * entry must emit EXACTLY its documented `ddl`. This is what makes the cookbook drift-proof — change
 * the emitter and this fails until the reference is updated, so the docs can never lie about the DDL.
 *
 * Pure emit (no live database). Round-trip fidelity (apply -> introspectAll -> diff = 0) is covered by
 * the PGlite round-trip tests in test/authoring.test.ts / test/kinds.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { allGroups, emit } from "../../examples/reference";

describe("reference cookbook: authoring -> DDL", () => {
  for (const group of allGroups) {
    describe(group.file, () => {
      for (const ex of group.examples) {
        test(ex.title, () => {
          expect(emit(ex.defs)).toBe(ex.ddl);
        });
      }
    });
  }

  test("every group has at least one example", () => {
    for (const group of allGroups) {
      expect(group.examples.length).toBeGreaterThan(0);
    }
  });
});
