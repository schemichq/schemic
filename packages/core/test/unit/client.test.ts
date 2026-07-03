import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { asyncDisposable, resolveConnection } from "../../src/client";

describe("asyncDisposable mixin", () => {
  test("adds [Symbol.asyncDispose] that calls close", async () => {
    let closed = 0;
    class Client {
      async close() {
        closed++;
      }
    }
    asyncDisposable(Client.prototype);
    const c = new Client() as Client & AsyncDisposable;
    await c[Symbol.asyncDispose]();
    expect(closed).toBe(1);
  });

  test("await using disposes at block exit", async () => {
    let closed = 0;
    class Client {
      async close() {
        closed++;
      }
    }
    asyncDisposable(Client.prototype);
    {
      await using _c = new Client() as Client & AsyncDisposable;
      expect(closed).toBe(0);
    }
    expect(closed).toBe(1);
  });
});

// Integration: resolveConnection against a real temp config (loadProject reads it from disk).
// The temp dir sits under the worktree so `@schemic/core` resolves via the workspace node_modules.
describe("resolveConnection", () => {
  const dir = mkdtempSync(join(import.meta.dir, "..", "..", ".orm-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const writeConfig = (body: string) =>
    writeFileSync(
      join(dir, "schemic.config.ts"),
      `import { defineConfig } from "@schemic/core/config";\n` +
        `import { connectionEntry } from "@schemic/core";\n` +
        `const conn = (over = {}) => connectionEntry("testdriver", { schema: "./database/schema", ...over });\n` +
        body,
    );

  test("resolves the sole connection (no name)", async () => {
    writeConfig(`export default defineConfig({ connections: { default: conn() } });`);
    const rc = await resolveConnection({ cwd: dir });
    expect(rc.connection).toBe("default");
    expect(rc.driver).toBe("testdriver");
    expect(rc.schemaPath.endsWith("database/schema")).toBe(true);
  });

  test("honors defaultConnection + resolves a named one", async () => {
    writeConfig(
      `export default defineConfig({ defaultConnection: "primary", connections: { primary: conn(), reporting: conn() } });`,
    );
    expect((await resolveConnection({ cwd: dir })).connection).toBe("primary");
    expect((await resolveConnection({ cwd: dir, name: "reporting" })).connection).toBe(
      "reporting",
    );
  });

  test("throws for an unknown connection name", async () => {
    writeConfig(`export default defineConfig({ connections: { default: conn() } });`);
    await expect(resolveConnection({ cwd: dir, name: "nope" })).rejects.toThrow(
      'connection "nope" is not defined',
    );
  });
});
