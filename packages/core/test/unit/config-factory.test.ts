import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveConnection } from "../../src/client";
import { defineConfig } from "../../src/config";
import { connectionEntry } from "../../src/connection";

// A fake driver entry whose embedded client opener just reflects the resolved config back.
// Direct connectionEntry call so the Client generic INFERS from the opener's return type.
const fake = () =>
  connectionEntry(
    "fakedriver",
    { schema: "./database/schema" },
    {
      client: async (cfg) => ({ connection: cfg.connection, closed: false }),
    },
  );

describe("config-as-factory (defineConfig().connect)", () => {
  test("connect() opens the entry's embedded client (default resolution)", async () => {
    const schemic = defineConfig({ connections: { default: fake() } });
    const db = await schemic.connect();
    expect(db.connection).toBe("default");
  });

  test("connect(name) is typed to the config's connection names", async () => {
    const schemic = defineConfig({
      defaultConnection: "main",
      connections: { main: fake(), reporting: fake() },
    });
    expect((await schemic.connect("reporting")).connection).toBe("reporting");
    expect((await schemic.connect()).connection).toBe("main");
    // @ts-expect-error — "nope" is not a configured connection name
    await expect(schemic.connect("nope")).rejects.toThrow("not defined");
  });

  test("an entry without an embedded client opener fails with a clear error", async () => {
    const schemic = defineConfig({
      connections: { default: connectionEntry("olddriver", { schema: "./s" }) },
    });
    await expect(schemic.connect()).rejects.toThrow(
      "predates config.connect()",
    );
  });

  test("resolver args are the TYPED 2nd param; connect(name, args) selects one config", async () => {
    let seen: { tenant: string } | undefined;
    const entry = connectionEntry(
      "fakedriver",
      (_ctx, args: { tenant: string }) => {
        seen = args;
        return { schema: "./s", key: args.tenant };
      },
      { client: async (cfg) => ({ connection: cfg.connection }) },
    );
    const schemic = defineConfig({ connections: { tenants: entry } });
    const db = await schemic.connect("tenants", { tenant: "acme" });
    expect(db.connection).toBe("tenants:acme");
    expect(seen).toEqual({ tenant: "acme" });
  });

  test("a BULK (array) resolution throws a teaching error from connect", async () => {
    const entry = connectionEntry(
      "fakedriver",
      () => [
        { schema: "./s", key: "a" },
        { schema: "./s", key: "b" },
      ],
      { client: async (cfg) => ({ connection: cfg.connection }) },
    );
    const schemic = defineConfig({ connections: { fleet: entry } });
    await expect(schemic.connect("fleet")).rejects.toThrow(
      /resolved to 2 configs \(a, b\).*Pass args/s,
    );
  });

  test("labels: config key > entry label hook > positional", async () => {
    const { resolveFromConfig } = await import("../../src/client");
    const entry = connectionEntry(
      "fakedriver",
      () => [{ schema: "./s", key: "keyed" }, { schema: "./s" }],
      { label: (cfg) => `lbl:${cfg.connection}` },
    );
    const config = defineConfig({ connections: { fleet: entry } });
    const r = await resolveFromConfig(config, "/proj", { name: "fleet" });
    expect(r.labels).toEqual(["keyed", "lbl:fleet"]);
  });
});

describe("schemic.ts discovery", () => {
  const dir = mkdtempSync(join(import.meta.dir, "..", "..", ".cfg-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const CONFIG_BODY =
    `import { defineConfig } from "@schemic/core/config";\n` +
    `import { connectionEntry } from "@schemic/core";\n` +
    `export const schemic = defineConfig({ connections: { default: connectionEntry("testdriver", { schema: "./database/schema" }) } });\n` +
    `export default schemic;\n`;

  test("a bare schemic.ts (named + default export) is discovered", async () => {
    writeFileSync(join(dir, "schemic.ts"), CONFIG_BODY);
    const rc = await resolveConnection({ cwd: dir });
    expect(rc.driver).toBe("testdriver");
  });

  test("a NAMED-ONLY `schemic` export (no default) loads — the scaffolded form", async () => {
    writeFileSync(
      join(dir, "schemic.config.ts"),
      CONFIG_BODY.replace("export default schemic;\n", "").replace(
        "testdriver",
        "nameddriver",
      ),
    );
    const rc = await resolveConnection({ cwd: dir });
    expect(rc.driver).toBe("nameddriver");
    rmSync(join(dir, "schemic.config.ts"));
  });

  test("schemic.config.ts wins over schemic.ts when both exist", async () => {
    writeFileSync(
      join(dir, "schemic.config.ts"),
      CONFIG_BODY.replace("testdriver", "configdriver"),
    );
    const rc = await resolveConnection({ cwd: dir });
    expect(rc.driver).toBe("configdriver");
    rmSync(join(dir, "schemic.config.ts"));
  });

  test("an unrelated schemic.ts (no connections) errors helpfully", async () => {
    writeFileSync(join(dir, "schemic.ts"), `export const helper = 42;\n`);
    await expect(resolveConnection({ cwd: dir })).rejects.toThrow(
      "doesn't export a config",
    );
  });
});

describe("chained config (defineConfig().connection(...))", () => {
  const fakeFactory = (
    input: import("../../src/connection").ConnectionInput<
      { schema: string; key?: string },
      // biome-ignore lint/suspicious/noExplicitAny: test factory
      any
    >,
  ) =>
    connectionEntry("fakedriver", input, {
      client: async (cfg) => ({
        connection: cfg.connection,
        query: async () => ["row"],
      }),
    });

  test("chained static + parameterized with typed accumulated ctx", async () => {
    let sawSibling: unknown;
    const schemic = defineConfig()
      .connection("main", fakeFactory, { schema: "./s" })
      .connection(
        "tenants",
        fakeFactory,
        async (ctx, args: { org: string }) => {
          const main = await ctx.connections.main; // thenable handle -> full client
          sawSibling = await main.query();
          return { schema: "./s", key: args.org };
        },
      );
    const db = await schemic.connect("tenants", { org: "acme" });
    expect(db.connection).toBe("tenants:acme");
    expect(sawSibling).toEqual(["row"]);
    expect((await schemic.connect("main")).connection).toBe("main");
    // @ts-expect-error — "nope" is not a chained connection name
    await expect(schemic.connect("nope")).rejects.toThrow("not defined");
  });

  test("order = visibility: a resolver reaching FORWARD is a compile error (and later a cycle guard)", async () => {
    defineConfig().connection("a", fakeFactory, (ctx) => {
      // @ts-expect-error — "b" is declared AFTER "a", so it is not visible here
      void ctx.connections.b;
      return { schema: "./s" };
    });
  });
});
