import { expect, test } from "bun:test";
import { buildSnapshot } from "../../src/cli/diff";
import { defineTable, sz } from "../../src/pure";

test("a non-Surreal field type error names the field + table", () => {
  const Bad = defineTable("widget", { id: sz.string(), blob: sz.custom() });
  const tables = [Bad] as unknown as Parameters<typeof buildSnapshot>[0];
  expect(() => buildSnapshot(tables)).toThrow(/field "blob" on table "widget"/);
});
