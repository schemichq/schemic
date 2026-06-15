import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig } from "../../src/cli/config";
import { diffPortable, portableDiff } from "../../src/cli/portable-diff";
import { surrealDriver } from "../../src/driver/surreal";
import { defineTable, s } from "../../src/pure";

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
      items: { op: string; ddl?: string; after?: string }[];
    };
    expect(parsed.driver).toBe("postgres");
    const adds = parsed.items.filter((i) => i.op === "add");
    expect(adds.length).toBeGreaterThan(0);
    expect(parsed.items.some((i) => i.op === "remove")).toBe(false);
    const ddl = adds.map((i) => i.ddl).join("\n");
    expect(ddl).toContain('CREATE TABLE "user"');
    expect(ddl).toContain('"id" text PRIMARY KEY');
    expect(ddl).toContain('"age" integer'); // option<int> -> nullable column
    expect(ddl).toContain('"active" boolean NOT NULL');
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
});
