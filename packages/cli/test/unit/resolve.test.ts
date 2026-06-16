import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Driver, driverNames, registerDriver } from "@schemic/core";
import { resolveOne, resolveTargets } from "../../src/cli/resolve";

// Fixtures live UNDER the package so a jiti-loaded config's `import "@schemic/core"` resolves through
// packages/cli/node_modules (a /tmp dir has no node_modules to walk up into).
const BASE = join(import.meta.dir, "..", ".tmp-resolve");

// A minimal fake driver so the engine's ensureDriver/getDriver are no-ops (no real package import).
// Only connect/close/query are exercised (by the cross-connection proxy tests); the IR ops are unused.
// The registry is shared with jiti-loaded config modules (core is native-imported), so registering
// "faux" here makes `connectionEntry("faux", …)` configs resolvable.
const queries: { url: unknown; sql: string }[] = [];
const faux = {
  name: "faux",
  async connect(config: { params: Record<string, unknown> }) {
    return { url: config.params.url };
  },
  async close() {},
  async query(conn: { url: unknown }, sql: string) {
    queries.push({ url: conn.url, sql });
    return [{ ok: 1 }];
  },
} as unknown as Driver<unknown>;

function writeConfig(body: string): string {
  const dir = mkdtempSync(join(BASE, "p-"));
  mkdirSync(join(dir, "schema"), { recursive: true });
  writeFileSync(join(dir, "schemic.config.ts"), body, "utf8");
  return join(dir, "schemic.config.ts");
}

beforeAll(() => {
  rmSync(BASE, { recursive: true, force: true });
  mkdirSync(BASE, { recursive: true });
  if (!driverNames().includes("faux")) registerDriver(faux);
});
afterAll(() => {
  rmSync(BASE, { recursive: true, force: true });
});

// A project with a single default connection + a 2-element tenant collection (resolver, --arg-aware).
const COLLECTION = `
import { connectionEntry } from "@schemic/core";
import { defineConfig } from "@schemic/core/config";
export default defineConfig({
  defaultConnection: "primary",
  connections: {
    primary: connectionEntry("faux", { schema: "./schema", url: "ws://primary" }),
    tenants: connectionEntry("faux", (ctx) =>
      (ctx.args.only ? [ctx.args.only] : ["acme", "globex"]).map((k) => ({
        schema: "./schema", key: k, url: "ws://" + k,
      }))),
  },
});
`;

describe("resolveTargets — addressing", () => {
  test("default resolves the defaultConnection", async () => {
    const config = writeConfig(COLLECTION);
    const targets = await resolveTargets({ config });
    expect(targets.map((t) => t.connection)).toEqual(["primary"]);
    expect(targets[0].driver).toBe("faux");
    expect(targets[0].params.url).toBe("ws://primary");
  });

  test("--connection on a collection fans out to every keyed element", async () => {
    const config = writeConfig(COLLECTION);
    const targets = await resolveTargets({ config, connection: "tenants" });
    expect(targets.map((t) => t.connection)).toEqual([
      "tenants:acme",
      "tenants:globex",
    ]);
  });

  test("--connection <name>:<key> pins one collection element", async () => {
    const config = writeConfig(COLLECTION);
    const targets = await resolveTargets({
      config,
      connection: "tenants:globex",
    });
    expect(targets.map((t) => t.connection)).toEqual(["tenants:globex"]);
    expect(targets[0].params.url).toBe("ws://globex");
  });

  test("--all resolves every connection, collections fanned out", async () => {
    const config = writeConfig(COLLECTION);
    const targets = await resolveTargets({ config, all: true });
    expect(targets.map((t) => t.connection)).toEqual([
      "primary",
      "tenants:acme",
      "tenants:globex",
    ]);
  });

  test("--arg is fed to resolvers (yields a subset)", async () => {
    const config = writeConfig(COLLECTION);
    const targets = await resolveTargets({
      config,
      connection: "tenants",
      arg: ["only=acme"],
    });
    expect(targets.map((t) => t.connection)).toEqual(["tenants:acme"]);
  });

  test("unknown connection errors with the known names", async () => {
    const config = writeConfig(COLLECTION);
    await expect(resolveTargets({ config, connection: "nope" })).rejects.toThrow(
      /No connection named "nope"/,
    );
  });
});

describe("resolveOne — single-connection guard", () => {
  test("rejects --all", async () => {
    const config = writeConfig(COLLECTION);
    await expect(resolveOne({ config, all: true })).rejects.toThrow(/--all/);
  });

  test("rejects a bare collection (must pin a :key)", async () => {
    const config = writeConfig(COLLECTION);
    await expect(
      resolveOne({ config, connection: "tenants" }),
    ).rejects.toThrow(/collection/);
  });

  test("resolves a pinned collection element", async () => {
    const config = writeConfig(COLLECTION);
    const one = await resolveOne({ config, connection: "tenants:acme" });
    expect(one.connection).toBe("tenants:acme");
  });
});

describe("resolveTargets — lazy cross-connection proxy", () => {
  test("a resolver can query a sibling, which is opened then closed", async () => {
    queries.length = 0;
    const config = writeConfig(`
import { connectionEntry } from "@schemic/core";
import { defineConfig } from "@schemic/core/config";
export default defineConfig({
  defaultConnection: "child",
  connections: {
    parent: connectionEntry("faux", { schema: "./schema", url: "ws://parent" }),
    child: connectionEntry("faux", async (ctx) => {
      const rows = await ctx.connections.parent.query("SELECT 1");
      return { schema: "./schema", url: "ws://child", probed: rows.length };
    }),
  },
});
`);
    const targets = await resolveTargets({ config, connection: "child" });
    expect(targets.map((t) => t.connection)).toEqual(["child"]);
    expect(targets[0].params.probed).toBe(1);
    expect(queries).toEqual([{ url: "ws://parent", sql: "SELECT 1" }]);
  });

  test("a resolution cycle errors instead of looping", async () => {
    const config = writeConfig(`
import { connectionEntry } from "@schemic/core";
import { defineConfig } from "@schemic/core/config";
export default defineConfig({
  defaultConnection: "a",
  connections: {
    a: connectionEntry("faux", async (ctx) => {
      await ctx.connections.b.query("x");
      return { schema: "./schema", url: "ws://a" };
    }),
    b: connectionEntry("faux", async (ctx) => {
      await ctx.connections.a.query("x");
      return { schema: "./schema", url: "ws://b" };
    }),
  },
});
`);
    await expect(
      resolveTargets({ config, connection: "a" }),
    ).rejects.toThrow(/cycle/);
  });
});
