import { describe, expect, test } from "bun:test";
import { buildSnapshot, diffSnapshots, isEmptyDiff } from "../../src/cli/diff";
import { defineTable, sz } from "../../src/pure";

const snap = (role: ReturnType<typeof sz.enum>) => {
  const User = defineTable("user", { id: sz.string(), role });
  const tables = [User] as unknown as Parameters<typeof buildSnapshot>[0];
  return (withStruct: boolean) => buildSnapshot(tables, [], { withStruct });
};

describe("structural change-detection (offline diff)", () => {
  test("suppresses a cosmetic enum reorder when the snapshot has a Struct", () => {
    const prev = snap(sz.enum(["admin", "user"]))(true);
    const next = snap(sz.enum(["user", "admin"]))(true);
    expect(isEmptyDiff(diffSnapshots(prev, next))).toBe(true);
  });

  test("still reports a real field change", () => {
    const prev = snap(sz.enum(["admin", "user"]))(true);
    const next = snap(sz.enum(["admin", "user", "guest"]))(true);
    expect(isEmptyDiff(diffSnapshots(prev, next))).toBe(false);
  });

  test("without a Struct snapshot, the DDL difference still shows (back-compat)", () => {
    const prev = snap(sz.enum(["admin", "user"]))(false);
    const next = snap(sz.enum(["user", "admin"]))(false);
    expect(isEmptyDiff(diffSnapshots(prev, next))).toBe(false);
  });
});
