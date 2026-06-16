import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
// Registers the "postgres" driver (now a separate package) for the `diff --driver postgres` test.
import "@schemic/postgres";
import type { ResolvedConfig } from "@schemic/core";
import { defineTable, s, surrealDriver } from "@schemic/surrealdb";
import {
  diffPortable,
  planPortable,
  portableDiff,
} from "../../src/cli/portable-diff";

// CLI driver-parametric path (multi-DB spike): `sz diff --driver postgres` authors from sz.*,
// connects to a real Postgres engine (PGlite), introspects, and reports the gap — all through the
// CLI's portable-diff function. Mirrors the e2e symlink-farm so a jiti-loaded schema fixture can
// `import "surreal-zod"` and resolve to this package's source.

const PKGS = join(import.meta.dir, "..", "..", ".."); // packages/
const CLI_NM = join(import.meta.dir, "..", "..", "node_modules");
const ROOT = join(import.meta.dir, "..", ".tmp-portable-diff");
const SCHEMA = join(ROOT, "database", "schema", "tables");

function makeConfig(): ResolvedConfig {
  // Only the fields portableDiff reads need to be real; the rest are filler. `driver` is the
  // AUTHORING driver (the schema imports `s` from @schemic/surrealdb); the postgres TARGET is the
  // `driverName` arg to portableDiff. So authoring lowers via surreal, the gap is computed vs pg.
  return {
    driver: "surrealdb",
    db: { url: "" }, // embedded in-memory PGlite
    schemaPath: join(ROOT, "database", "schema"),
    root: ROOT,
    schemaIsFile: false,
    migrationsDir: join(ROOT, "database", "migrations"),
    metaDir: join(ROOT, "database", "migrations", "meta"),
    migrationsTable: "_migrations",
    checkDb: { url: "" },
    checkEngine: "auto",
    checkBinary: "surreal",
  } as ResolvedConfig;
}

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(SCHEMA, { recursive: true });
  // Symlink farm so the jiti-loaded fixture's `import "@schemic/surrealdb"` resolves to THIS source
  // (bun -> src export → same module instance as the test's surrealDriver), plus its peer deps.
  const scope = join(ROOT, "node_modules", "@schemic");
  mkdirSync(scope, { recursive: true });
  symlinkSync(join(PKGS, "surrealdb"), join(scope, "surrealdb"), "dir");
  symlinkSync(join(PKGS, "core"), join(scope, "core"), "dir");
  for (const dep of ["surrealdb", "zod"])
    symlinkSync(
      realpathSync(join(CLI_NM, dep)),
      join(ROOT, "node_modules", dep),
      "dir",
    );
  writeFileSync(
    join(SCHEMA, "user.ts"),
    `import { defineTable, s } from "@schemic/surrealdb";
export const user = defineTable("user", {
  name: s.string(),
  age: s.int().optional(),
  active: s.boolean(),
});
`,
  );
});

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

/** Capture console.log output of an async block. */
async function capture(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return lines.join("\n");
}

describe("sz diff --driver postgres (CLI portable path)", () => {
  test("against an empty database, reports the CREATE TABLE gap as adds", async () => {
    const out = await capture(() =>
      portableDiff(makeConfig(), "postgres", { json: true }),
    );
    const parsed = JSON.parse(out) as {
      driver: string;
      up: string[];
      down: string[];
    };
    expect(parsed.driver).toBe("postgres");
    expect(parsed.up.length).toBeGreaterThan(0);
    const ddl = parsed.up.join("\n");
    expect(ddl).toContain('CREATE TABLE "user"');
    expect(ddl).toContain('"id" text PRIMARY KEY');
    expect(ddl).toContain('"age" integer'); // option<int> -> nullable column
    expect(ddl).toContain('"active" boolean NOT NULL');
    // down rolls it back.
    expect(parsed.down.join("\n")).toContain('DROP TABLE IF EXISTS "user"');
  });
});

describe("diffPortable (driver-neutral structural diff)", () => {
  test("surreal: adds only the new field; nothing removed", () => {
    const cur = surrealDriver.lower(
      [defineTable("user", { name: s.string() })],
      [],
    );
    const des = surrealDriver.lower(
      [defineTable("user", { name: s.string(), age: s.int().optional() })],
      [],
    );
    const items = diffPortable(surrealDriver, cur, des);
    expect(items.filter((i) => i.op === "add").map((i) => i.key)).toEqual([
      "field:user:age",
    ]);
    expect(items.some((i) => i.op === "remove" || i.op === "change")).toBe(
      false,
    );
  });

  test("surreal: a dropped table shows as remove", () => {
    const cur = surrealDriver.lower(
      [
        defineTable("user", { name: s.string() }),
        defineTable("post", { title: s.string() }),
      ],
      [],
    );
    const des = surrealDriver.lower(
      [defineTable("user", { name: s.string() })],
      [],
    );
    const removed = diffPortable(surrealDriver, cur, des).filter(
      (i) => i.op === "remove",
    );
    expect(removed.map((i) => i.key)).toContain("table::post");
  });

  test("identical schemas diff to empty", () => {
    const db = surrealDriver.lower(
      [defineTable("user", { name: s.string() })],
      [],
    );
    expect(diffPortable(surrealDriver, db, db)).toEqual([]);
  });

  test("surreal: plan emits DEFINE up + REMOVE down for an added field", () => {
    const cur = surrealDriver.lower(
      [defineTable("user", { name: s.string() })],
      [],
    );
    const des = surrealDriver.lower(
      [defineTable("user", { name: s.string(), age: s.int().optional() })],
      [],
    );
    const { up, down } = planPortable(
      surrealDriver,
      diffPortable(surrealDriver, cur, des),
    );
    expect(up.join("\n")).toContain("DEFINE FIELD age ON TABLE user");
    expect(down.join("\n")).toMatch(/REMOVE FIELD.*age/);
  });
});

describe("driver.diff (portable IR -> up/down + display items)", () => {
  test("surreal: an added field -> DEFINE up, REMOVE down, add item", () => {
    const prev = surrealDriver.lower(
      [defineTable("user", { name: s.string() })],
      [],
    );
    const next = surrealDriver.lower(
      [defineTable("user", { name: s.string(), age: s.int().optional() })],
      [],
    );
    const diff = surrealDriver.diff(prev, next);
    expect(diff.up.join("\n")).toContain("DEFINE FIELD age ON TABLE user");
    expect(diff.down.join("\n")).toMatch(/REMOVE FIELD.*age/);
    expect(
      diff.items?.some((i) => i.op === "add" && i.key === "field:user:age"),
    ).toBe(true);
  });

  // The keystone: a clause-only change must ALTER (preserve row data), NOT DEFINE … OVERWRITE.
  // This only works because the portable->DDL emission now carries clause maps (increment 1).
  test("surreal: a clause-only change uses ALTER FIELD, not OVERWRITE", () => {
    const prev = surrealDriver.lower(
      [defineTable("user", { name: s.string() })],
      [],
    );
    const next = surrealDriver.lower(
      [defineTable("user", { name: s.string().$comment("the name") })],
      [],
    );
    const up = surrealDriver.diff(prev, next).up.join("\n");
    expect(up).toContain("ALTER FIELD name ON TABLE user");
    expect(up).not.toContain("OVERWRITE");
  });

  // NOTE: postgres-specific diff cases (new table, FK-drop ordering, field-level ADD COLUMN,
  // non-destructiveness) now live in @schemic/postgres (packages/postgres/test) with standalone
  // portable-IR fixtures — they no longer belong to core.
});

describe("surreal: record REFERENCE clause (regression — was dropped on the portable path)", () => {
  test("emit includes REFERENCE; a bare reference renders without ON DELETE", () => {
    const db = surrealDriver.lower(
      [defineTable("doc", { author: s.recordId("user").reference() })],
      [],
    );
    const ddl = surrealDriver
      .emit(surrealDriver.normalize(db))
      .map((st) => st.ddl)
      .join("\n");
    expect(ddl).toMatch(/DEFINE FIELD author ON TABLE doc .*REFERENCE/);
    expect(ddl).not.toContain("ON DELETE");
  });

  test("ON DELETE action renders; a reference-only change is detected as ALTER FIELD", () => {
    const cascade = surrealDriver.lower(
      [
        defineTable("doc", {
          author: s.recordId("user").reference({ onDelete: "cascade" }),
        }),
      ],
      [],
    );
    expect(
      surrealDriver
        .emit(surrealDriver.normalize(cascade))
        .map((st) => st.ddl)
        .join("\n"),
    ).toContain("REFERENCE ON DELETE CASCADE");

    // adding a reference where there was none must produce a migration (was silently missed).
    const without = surrealDriver.lower(
      [defineTable("doc", { author: s.recordId("user") })],
      [],
    );
    const up = surrealDriver.diff(without, cascade).up.join("\n");
    expect(up).toMatch(
      /ALTER FIELD author ON TABLE doc.*REFERENCE ON DELETE CASCADE/,
    );
  });

  test("IGNORE (SurrealDB's materialized default) canonicalizes to a bare REFERENCE — no phantom vs live", () => {
    // A bare reference lowers offline to reference:{} but INFO STRUCTURE materializes it as
    // { on_delete: 'IGNORE' }; both must canonicalize identically or every bare ref phantom-diffs.
    const bare = surrealDriver.lower(
      [defineTable("doc", { author: s.recordId("user").reference() })],
      [],
    );
    const liveLike = structuredClone(bare);
    const f = liveLike.tables[0].fields.find((x) => x.name === "author");
    if (f) f.reference = { on_delete: "IGNORE" };
    expect(surrealDriver.diff(bare, liveLike).up).toEqual([]);
  });
});
