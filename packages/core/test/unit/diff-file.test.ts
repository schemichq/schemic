import { describe, expect, test } from "bun:test";
import { formatItems } from "../../src/cli/diff";
import { buildSnapshot, diffSnapshots } from "../../src/cli/surreal-diff";
import { EMPTY_SNAPSHOT } from "../../src/cli/meta";
import { defineTable, s } from "../../src/pure";

describe("diff file annotations", () => {
  const User = defineTable("user", { id: s.string(), email: s.email() });
  const tables = [User] as unknown as Parameters<typeof buildSnapshot>[0];
  const FILE = "database/schema/tables/user.ts";
  const fileOf = new Map<unknown, string>([[User, `/proj/${FILE}`]]);
  const snapshot = () => buildSnapshot(tables, [], { fileOf, root: "/proj" });

  test("buildSnapshot stores the project-relative file per statement", () => {
    for (const s of Object.values(snapshot().statements))
      expect(s.file).toBe(FILE);
  });

  test("diffSnapshots carries the file onto add items", () => {
    const diff = diffSnapshots(EMPTY_SNAPSHOT, snapshot());
    expect(diff.items?.length).toBeGreaterThan(0);
    expect(diff.items?.every((it) => it.file === FILE)).toBe(true);
  });

  test("a removed object keeps the file it was in (from the snapshot)", () => {
    const diff = diffSnapshots(snapshot(), EMPTY_SNAPSHOT);
    const removed = (diff.items ?? []).filter((it) => it.op === "remove");
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.every((it) => it.file === FILE)).toBe(true);
  });

  test("formatItems heads each group with the file path (git-style, no 'Table:')", () => {
    const diff = diffSnapshots(EMPTY_SNAPSHOT, snapshot());
    const out = formatItems(diff.items ?? []);
    expect(out).toContain(FILE);
    expect(out).not.toContain("Table:");
  });

  test("no file: falls back to the bare object name (old snapshots / live DB)", () => {
    const diff = diffSnapshots(EMPTY_SNAPSHOT, buildSnapshot(tables));
    expect(diff.items?.every((it) => it.file === undefined)).toBe(true);
    const out = formatItems(diff.items ?? []);
    expect(out).not.toContain(".ts");
    expect(out).not.toContain("Table:");
    expect(out).toContain("user");
  });
});

describe("struct snapshot (offline diff --ts)", () => {
  const User = defineTable("user", {
    id: s.string(),
    age: s.int().optional(),
  });
  const tables = [User] as unknown as Parameters<typeof buildSnapshot>[0];

  test("withStruct attaches the normalized Struct-IR", () => {
    const snap = buildSnapshot(tables, [], { withStruct: true });
    expect(snap.struct?.tables.map((t) => t.name)).toEqual(["user"]);
    // age is normalized to option<int>
    const age = snap.struct?.tables[0].fields.find((f) => f.name === "age");
    expect(age?.kind).toBe("option<int>");
  });

  test("struct is absent by default (no withStruct)", () => {
    expect(buildSnapshot(tables).struct).toBeUndefined();
  });
});
