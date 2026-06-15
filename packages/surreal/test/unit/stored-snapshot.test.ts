import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  filterPortable,
  mergeStored,
  parseFilter,
  readSnapshot,
  type StoredSnapshot,
} from "@schemic/core";
import { buildSnapshot } from "../../src/cli/surreal-diff";
import { surrealDriver } from "../../src/driver/surreal";
import { defineTable, s } from "../../src/pure";

const ROOT = join(import.meta.dir, ".tmp-stored-snapshot");
const META = join(ROOT, "meta");
const SNAP = join(META, "_snapshot.json");

const User = defineTable("user", { name: s.string(), age: s.int().optional() });

beforeAll(() => mkdirSync(META, { recursive: true }));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const writeSnap = (obj: unknown) =>
  writeFileSync(SNAP, JSON.stringify(obj, null, 2));

// Lower a heterogeneous list of table defs to the portable IR (test fixtures vary table shape).
const lower = (tables: unknown[] = [User]) =>
  surrealDriver.lower(tables as never, []);

const stored = (tables: unknown[] = [User]): StoredSnapshot => ({
  version: 2,
  driver: "surreal",
  portable: lower(tables),
  files: {},
});

describe("readSnapshot v1 -> v2 read-compat", () => {
  test("a v1 snapshot with a Struct lifts to the portable form", () => {
    // biome-ignore lint/suspicious/noExplicitAny: bridge the lib/src TableDef duality (see buildSnapshot).
    const v1 = buildSnapshot([User] as any, [], { withStruct: true });
    writeSnap({ version: 1, statements: v1.statements, struct: v1.struct });
    // v1 -> v2 upgrade is driver-owned now (only the driver can lift its legacy struct).
    const out = readSnapshot(META, surrealDriver);
    expect(out.version).toBe(2);
    expect(out.driver).toBe("surreal");
    expect(out.portable.tables.map((t) => t.name)).toEqual(["user"]);
  });

  test("an empty v1 snapshot becomes an empty v2 snapshot", () => {
    writeSnap({ version: 1, statements: {} });
    const out = readSnapshot(META);
    expect(out.version).toBe(2);
    expect(out.portable.tables).toEqual([]);
  });

  test("a non-empty v1 snapshot WITHOUT a Struct errors with upgrade guidance", () => {
    writeSnap({
      version: 1,
      statements: { "table::user": { kind: "table", name: "user", ddl: "x" } },
    });
    expect(() => readSnapshot(META)).toThrow(/predates the portable format/);
  });

  test("a v2 snapshot passes through unchanged", () => {
    const snap = stored();
    writeSnap(snap);
    const out = readSnapshot(META);
    expect(out.version).toBe(2);
    expect(out.portable.tables.map((t) => t.name)).toEqual(["user"]);
  });

  test("a missing snapshot reads as empty v2", () => {
    rmSync(SNAP, { force: true });
    const out = readSnapshot(META);
    expect(out.version).toBe(2);
    expect(out.portable.tables).toEqual([]);
  });
});

describe("portable filter + merge", () => {
  test("filterPortable drops access by default (opt-in)", () => {
    const out = filterPortable(
      { ...lower(), accesses: [{ name: "acc" } as never] },
      parseFilter({}),
    );
    expect(out.accesses).toEqual([]);
    expect(out.tables.map((t) => t.name)).toEqual(["user"]);
  });

  test("mergeStored: included kinds take next, excluded (access) keep prev", () => {
    const prev: StoredSnapshot = {
      ...stored(),
      portable: { ...lower(), accesses: [{ name: "old" } as never] },
    };
    const next: StoredSnapshot = {
      ...stored(),
      portable: { ...lower(), accesses: [{ name: "new" } as never] },
    };
    const merged = mergeStored(prev, next, parseFilter({})); // access excluded
    expect(merged.portable.accesses.map((a) => a.name)).toEqual(["old"]);
    expect(merged.portable.tables.map((t) => t.name)).toEqual(["user"]);
  });
});
