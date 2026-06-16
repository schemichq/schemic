import { describe, expect, test } from "bun:test";
import { isEmptyDiff } from "@schemic/core";
import { buildSnapshot, diffSnapshots } from "../../src/cli/surreal-diff";
import { defineTable, s } from "../../src/pure";

const snap = (role: ReturnType<typeof s.enum>) => {
  const User = defineTable("user", { id: s.string(), role });
  const tables = [User] as unknown as Parameters<typeof buildSnapshot>[0];
  return (withStruct: boolean) => buildSnapshot(tables, [], { withStruct });
};

describe("structural change-detection (offline diff)", () => {
  test("suppresses a cosmetic enum reorder when the snapshot has a Struct", () => {
    const prev = snap(s.enum(["admin", "user"]))(true);
    const next = snap(s.enum(["user", "admin"]))(true);
    expect(isEmptyDiff(diffSnapshots(prev, next))).toBe(true);
  });

  test("still reports a real field change", () => {
    const prev = snap(s.enum(["admin", "user"]))(true);
    const next = snap(s.enum(["admin", "user", "guest"]))(true);
    expect(isEmptyDiff(diffSnapshots(prev, next))).toBe(false);
  });

  test("without a Struct snapshot, the DDL difference still shows (back-compat)", () => {
    const prev = snap(s.enum(["admin", "user"]))(false);
    const next = snap(s.enum(["user", "admin"]))(false);
    expect(isEmptyDiff(diffSnapshots(prev, next))).toBe(false);
  });
});
