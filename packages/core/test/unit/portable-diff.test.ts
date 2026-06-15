import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig } from "../../src/cli/config";
import {
  diffPortable,
  planPortable,
  portableDiff,
} from "../../src/cli/portable-diff";
import type { PortableDb } from "../../src/driver/portable-ir";
import { postgresDriver } from "../../src/driver/postgres";
import { surrealDriver } from "../../src/driver/surreal";
import { defineTable, s } from "../../src/pure";

const EMPTY_DB: PortableDb = { tables: [], functions: [], accesses: [] };

// CLI driver-parametric path (multi-DB spike): `sz diff --driver postgres` authors from sz.*,
// connects to a real Postgres engine (PGlite), introspects, and reports the gap — all through the
// CLI's portable-diff function. Mirrors the e2e symlink-farm so a jiti-loaded schema fixture can
// `import "surreal-zod"` and resolve to this package's source.

const CORE = join(import.meta.dir, "..", "..");
const ROOT = join(import.meta.dir, "..", ".tmp-portable-diff");
const SCHEMA = join(ROOT, "database", "schema", "tables");

function makeConfig(): ResolvedConfig {
  // Only the fields portableDiff reads need to be real; the rest are filler.
  return {
    driver: "postgres",
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
  mkdirSync(join(ROOT, "node_modules", "@schemic"), { recursive: true });
  // Symlink so the fixture's `import "@schemic/core"` resolves to this package (bun -> src export).
  symlinkSync(CORE, join(ROOT, "node_modules", "@schemic", "core"), "dir");
  writeFileSync(
    join(SCHEMA, "user.ts"),
    `import { defineTable, s } from "@schemic/core";
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

  test("postgres: a new table -> CREATE up, DROP down", () => {
    const next = surrealDriver.lower(
      [defineTable("user", { name: s.string(), active: s.boolean() })],
      [],
    );
    const diff = postgresDriver.diff(EMPTY_DB, next);
    expect(diff.up.join("\n")).toContain('CREATE TABLE "user"');
    expect(diff.down.join("\n")).toContain('DROP TABLE IF EXISTS "user"');
    expect(diff.items?.length).toBeGreaterThan(0);
  });
});
