import { describe, expect, test } from "bun:test";
import { buildSnapshot, diffSnapshots, formatItems } from "../../src/cli/diff";
import { EMPTY_SNAPSHOT } from "../../src/cli/meta";
import { defineTable, sz } from "../../src/pure";

describe("diff file annotations", () => {
  const User = defineTable("user", { id: sz.string(), email: sz.email() });
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
