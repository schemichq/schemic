import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedConfig } from "../../src/cli/config";
import { listMigrations } from "../../src/cli/meta";
import { newMigration } from "../../src/cli/migrate";

function tmpConfig(): ResolvedConfig {
  const root = mkdtempSync(join(tmpdir(), "sz-"));
  const migrationsDir = join(root, "migrations");
  return {
    schema: "schemas",
    migrations: "migrations",
    db: { url: "", namespace: "", database: "" },
    checkDb: { url: "", namespace: "", database: "" },
    checkEngine: "auto",
    checkBinary: "surreal",
    root,
    schemaPath: join(root, "schemas"),
    schemaIsFile: false,
    migrationsDir,
    metaDir: join(migrationsDir, "meta"),
    migrationsTable: "_migrations",
  };
}

describe("newMigration", () => {
  test("scaffolds a timestamped .surql migration with up/down branches", () => {
    const config = tmpConfig();
    const { tag, file } = newMigration(config, "backfill users");
    expect(file).toMatch(/^\d{14}_backfill_users\.surql$/);
    expect(file).toBe(`${tag}.surql`);
    const content = readFileSync(join(config.migrationsDir, file), "utf8");
    expect(content).toContain('IF $direction = "up"');
    expect(content).toContain("ELSE");
  });

  test("same-name migrations get distinct tags, listed in order", () => {
    const config = tmpConfig();
    const a = newMigration(config, "fix");
    const b = newMigration(config, "fix");
    expect(a.tag).not.toBe(b.tag);
    expect(listMigrations(config.migrationsDir).map((m) => m.tag)).toEqual([
      a.tag,
      b.tag,
    ]);
  });
});
