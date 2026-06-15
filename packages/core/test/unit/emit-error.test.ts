import { expect, test } from "bun:test";
import { buildSnapshot } from "../../src/cli/diff";
import { defineTable, s } from "../../src/pure";

test("a non-Surreal field type error names the field + table", () => {
  const Bad = defineTable("widget", {
    id: s.string(),
    // s.custom() has no SurrealQL mapping — defineTable rejects it at compile time (that's the
    // point); here we assert the RUNTIME error pins the field + table.
    // @ts-expect-error intentional no-DDL field
    blob: s.custom(),
  });
  const tables = [Bad] as unknown as Parameters<typeof buildSnapshot>[0];
  expect(() => buildSnapshot(tables)).toThrow(/field "blob" on table "widget"/);
});
