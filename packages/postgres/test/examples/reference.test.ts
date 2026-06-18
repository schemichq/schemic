/**
 * Verifies the @schemic/postgres REFERENCE example cookbook (`examples/reference/*`): every catalog
 * entry must emit EXACTLY its documented `ddl`. This is what makes the cookbook drift-proof — change
 * the emitter and this fails until the reference is updated, so the docs can never lie about the DDL.
 *
 * `defs` is DERIVED from `code` (via _kit `evalDefs`), so `emit(defs) === ddl` is really
 * `emit(evalDefs(code)) === ddl` — the snippet shown to users, the emitted objects, and the golden DDL
 * are checked to agree (the convention's "keep code honest" SHOULD).
 *
 * Pure emit (no live database). Round-trip fidelity (apply -> introspectAll -> diff = 0) is covered by
 * the PGlite round-trip tests in test/authoring.test.ts / test/kinds.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { allGroups, emit, evalDefs } from "../../examples/reference";

describe("reference cookbook: authoring -> DDL", () => {
  for (const group of allGroups) {
    describe(group.file, () => {
      for (const ex of group.examples) {
        test(ex.title, () => {
          // code is the source of truth: it must be present and re-evaluate to defs that emit the golden.
          expect(ex.code.trim().length).toBeGreaterThan(0);
          expect(emit(evalDefs(ex.code))).toBe(ex.ddl);
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
