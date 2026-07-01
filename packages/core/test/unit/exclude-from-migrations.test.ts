import { describe, expect, test } from "bun:test";
import {
  buildKindDiff,
  emitKinds,
  type KindEngine,
  KindRegistry,
  snapshotKinds,
} from "../../src/kind";

// A registry with one MANAGED kind (table) and one migration-UNMANAGED kind (access, secret-bearing).
interface PTable {
  kind: "table";
  name: string;
}
interface PAccess {
  kind: "access";
  name: string;
}

const registry = new KindRegistry();
const tableEngine: KindEngine<PTable, PTable> = {
  lower: (t) => t,
  emit: (t) => [`TABLE ${t.name}`],
  remove: (t) => [`DROP TABLE ${t.name}`],
};
registry.define({
  name: "table",
  build: (name: string): PTable => ({ kind: "table", name }),
  ...tableEngine,
});
const accessEngine: KindEngine<PAccess, PAccess> = {
  lower: (a) => a,
  emit: (a) => [`DEFINE ACCESS ${a.name} KEY $secret`],
  remove: (a) => [`REMOVE ACCESS ${a.name}`],
  introspect: async () => [{ kind: "access", name: "api" }],
  excludeFromMigrations: true, // the flag under test
};
registry.define({
  name: "access",
  build: (name: string): PAccess => ({ kind: "access", name }),
  ...accessEngine,
});

const table: PTable = { kind: "table", name: "user" };
const access: PAccess = { kind: "access", name: "api" };

describe("excludeFromMigrations", () => {
  test("registry.isExcludedFromMigrations reflects the flag", () => {
    expect(registry.isExcludedFromMigrations("access")).toBe(true);
    expect(registry.isExcludedFromMigrations("table")).toBe(false);
    expect(registry.isExcludedFromMigrations("unregistered")).toBe(false);
  });

  test("snapshotKinds(schema, registry) drops the excluded kind", () => {
    const snap = snapshotKinds([table, access], registry);
    expect(Object.keys(snap.kinds)).toEqual(["table"]);
    // without a registry, nothing is filtered (backward-compatible)
    expect(Object.keys(snapshotKinds([table, access]).kinds).sort()).toEqual([
      "access",
      "table",
    ]);
  });

  test("emitKinds skips the excluded kind", () => {
    const ddl = emitKinds(registry, [table, access]).join("\n");
    expect(ddl).toContain("TABLE user");
    expect(ddl).not.toContain("DEFINE ACCESS");
  });

  test("buildKindDiff never diffs the excluded kind (add / change / remove)", () => {
    // add: an access appears in desired but not prev -> no up/down
    const added = buildKindDiff(registry, [], [table, access]);
    expect(added.up.join("\n")).toContain("TABLE user");
    expect(added.up.join("\n")).not.toContain("ACCESS");
    expect(added.down.join("\n")).not.toContain("ACCESS");

    // remove: access in prev but gone from desired -> still no output (not auto-dropped)
    const removed = buildKindDiff(registry, [access], []);
    expect(removed.up.join("\n")).not.toContain("ACCESS");

    // change: access key/def changes -> no migration (managed out-of-band)
    const changed = buildKindDiff(
      registry,
      [{ kind: "access", name: "api" }],
      [{ kind: "access", name: "api" }],
    );
    expect(changed.up).toEqual([]);
  });
});
