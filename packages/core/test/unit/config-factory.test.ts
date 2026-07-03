import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveConnection } from "../../src/client";
import { defineConfig } from "../../src/config";
import { connectionEntry, type StandardSchemaLike } from "../../src/connection";

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

  test("args are validated against the entry's schema before resolving", async () => {
    const argsSchema: StandardSchemaLike = {
      "~standard": {
        validate: (v) =>
          v && typeof (v as { tenant?: unknown }).tenant === "string"
            ? { value: v }
            : { issues: [{ message: "tenant is required" }] },
      },
    };
    let seenArgs: Record<string, string> | undefined;
    const entry = connectionEntry(
      "fakedriver",
      (ctx) => {
        seenArgs = ctx.args;
        return { schema: "./s", key: ctx.args.tenant };
      },
      {
        args: argsSchema,
        client: async (cfg) => ({ connection: cfg.connection }),
      },
    );
    const schemic = defineConfig({ connections: { tenants: entry } });

    const db = await schemic.connect("tenants", {
      args: { tenant: "acme" },
      key: "acme",
    });
    expect(db.connection).toBe("tenants:acme");
    expect(seenArgs).toEqual({ tenant: "acme" });

    await expect(
      schemic.connect("tenants", { args: {} as { tenant: string } }),
    ).rejects.toThrow("tenant is required");
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
