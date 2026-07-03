import { describe, expect, test } from "bun:test";
import { resolveConnectionConfig } from "../../src/cli-kit/config";
import type { SchemicConfig } from "../../src/config";

const config = { connections: {} } as SchemicConfig;
const rc = (conn: { schema: string; migrations?: string }) =>
  resolveConnectionConfig(config, "default", conn, "testdriver", "/proj");

describe("migrations dir defaults RELATIVE TO THE SCHEMA (the documented contract)", () => {
  test("standard scaffold layout is unchanged", () => {
    expect(rc({ schema: "./database/schema" }).migrationsDir).toBe(
      "/proj/database/migrations",
    );
  });

  test("a nested schema gets its sibling migrations dir (the sc-gen split-state bug)", () => {
    expect(rc({ schema: "./src/database/schema" }).migrationsDir).toBe(
      "/proj/src/database/migrations",
    );
  });

  test("a single-file schema gets migrations next to the file", () => {
    expect(rc({ schema: "./db/schema.ts" }).migrationsDir).toBe(
      "/proj/db/migrations",
    );
  });

  test("an explicit migrations override still resolves from the project root", () => {
    expect(
      rc({ schema: "./src/database/schema", migrations: "./mig" })
        .migrationsDir,
    ).toBe("/proj/mig");
  });
});
