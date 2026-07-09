import { describe, expect, test } from "bun:test";
import type { ChainableDriverFactory } from "@schemic/core";
import { defineConfig } from "@schemic/core/config";
import type { ConnectionConfigBase } from "@schemic/core/driver";
import { getDriver } from "@schemic/core/driver";
import type { PgClient } from "../src/client";
import { postgresDriver } from "../src/driver";
import {
  identifier,
  type PgConn,
  type PostgresConnectionConfig,
  pgSql,
  postgresConnection,
  raw,
} from "../src/index";

// Additive multi-connection surface (built off feat/multi-connection): the `postgresConnection`
// factory, the `pgSql` safe tagged-template builder, and `Driver.query`. No `connect`/config
// migration here (that's gated on core's GO).

const ctx = { connections: {}, args: {}, env: {} as NodeJS.ProcessEnv };

describe("pgSql tagged-template builder", () => {
  test("interpolated values become positional $1..$n params", () => {
    const id = "u1";
    const active = true;
    const q = pgSql`SELECT * FROM users WHERE id = ${id} AND active = ${active}`;
    expect(q.query).toBe("SELECT * FROM users WHERE id = $1 AND active = $2");
    expect(q.params).toEqual([id, active]);
  });

  test("identifier() and raw() splice structure, not params", () => {
    const q = pgSql`SELECT * FROM ${identifier("user")} ${raw("ORDER BY id")} LIMIT ${5}`;
    expect(q.query).toBe('SELECT * FROM "user" ORDER BY id LIMIT $1');
    expect(q.params).toEqual([5]);
  });

  test("nested pgSql composes — placeholders renumber, params merge", () => {
    const filter = pgSql`name = ${"Ada"}`;
    const q = pgSql`SELECT * FROM "user" WHERE id = ${"u1"} AND ${filter}`;
    expect(q.query).toBe('SELECT * FROM "user" WHERE id = $1 AND name = $2');
    expect(q.params).toEqual(["u1", "Ada"]);
  });

  test("identifier() escapes embedded double quotes", () => {
    expect(identifier('we"ird').__pgRaw).toBe('"we""ird"');
  });
});

describe("postgresConnection factory", () => {
  // resolve() erases to the neutral ConnectionConfigBase[] (driver params are opaque to core), so
  // cast back to the rich config type when asserting on driver-specific fields like `url`.
  const resolved = (out: ConnectionConfigBase[]) =>
    out as PostgresConnectionConfig[];

  test("static config -> branded entry whose resolve yields [config]", async () => {
    const cfg: PostgresConnectionConfig = { schema: "./schema", url: "" };
    const entry = postgresConnection(cfg);
    expect(entry.__schemic).toBe("connection");
    expect(entry.driver).toBe("postgres");
    expect(resolved(await entry.resolve(ctx))).toEqual([cfg]);
  });

  test("single-config resolver -> resolve yields one element (args = typed 2nd param)", async () => {
    const entry = postgresConnection((_ctx, args: { dir?: string }) => ({
      schema: "./schema",
      url: `file:${args.dir ?? "/tmp/db"}`,
    }));
    expect(resolved(await entry.resolve(ctx, { dir: "/data" }))).toEqual([
      { schema: "./schema", url: "file:/data" },
    ]);
  });

  test("collection resolver -> resolve yields the keyed array as-is", async () => {
    const entry = postgresConnection(() => [
      { key: "a", schema: "./a", url: "" },
      { key: "b", schema: "./b", url: "" },
    ]);
    const out = await entry.resolve(ctx);
    expect(out.map((e) => e.key)).toEqual(["a", "b"]);
  });
});

describe("Driver.query (named -> positional, passthrough)", () => {
  test("named $vars are bound positionally against a real PGlite engine", async () => {
    const driver = getDriver("postgres");
    const conn = (await driver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await conn.exec(
        `CREATE TABLE "user" ("id" text PRIMARY KEY, "name" text);
         INSERT INTO "user" VALUES ('u1','Ada'), ('u2','Lin');`,
      );
      const rows = await driver.query?.<{ id: string; name: string }>(
        conn,
        `SELECT * FROM "user" WHERE name = $who`,
        { who: "Ada" },
      );
      expect(rows).toEqual([{ id: "u1", name: "Ada" }]);
    } finally {
      await conn.close();
    }
  });

  test("a pgSql bound query runs via the raw connection (positional params)", async () => {
    const driver = getDriver("postgres");
    const conn = (await driver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await conn.exec(
        `CREATE TABLE "user" ("id" text PRIMARY KEY, "name" text);
         INSERT INTO "user" VALUES ('u1','Ada');`,
      );
      const q = pgSql`SELECT "name" FROM ${identifier("user")} WHERE id = ${"u1"}`;
      const { rows } = await conn.query<{ name: string }>(q.query, q.params);
      expect(rows).toEqual([{ name: "Ada" }]);
    } finally {
      await conn.close();
    }
  });

  test("a missing binding throws a clear error", async () => {
    const driver = getDriver("postgres");
    const conn = (await driver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      expect(
        driver.query?.(conn, `SELECT $missing`, { other: 1 }),
      ).rejects.toThrow(/no binding for \$missing/);
    } finally {
      await conn.close();
    }
  });

  test("postgresConnection embeds a client opener + a dialect label (for config.connect / reporting)", () => {
    const entry = postgresConnection({ schema: "./db", url: "" });
    expect(entry.driver).toBe("postgres");
    expect(typeof entry.client).toBe("function"); // lazy PgClient opener
    expect(typeof entry.label).toBe("function"); // pg display identity (url | pglite(memory))
    // label reads the resolved params.url; empty/omitted -> the in-memory marker.
    expect(entry.label?.({ params: { url: "" } } as never)).toBe(
      "pglite(memory)",
    );
    expect(entry.label?.({ params: { url: "file:./data" } } as never)).toBe(
      "file:./data",
    );
  });

  test("initScaffold keeps schemic.config.ts, now with the named `schemic` export (+ default)", () => {
    // Per the refined spec: no file rename — the loader accepts a named `schemic` export, so the
    // named-export DX works in schemic.config.ts itself.
    const files = postgresDriver.initScaffold?.() ?? {};
    expect(Object.keys(files)).toContain("schemic.config.ts");
    const cfg = files["schemic.config.ts"] ?? "";
    expect(cfg).toContain("export const schemic = defineConfig({");
    expect(cfg).toContain("export default schemic;");
  });
});

describe("chained defineConfig().connection() (typed cross-connections)", () => {
  // (1) `postgresConnection` IS a valid `.connection()` driver marker — assignable to the core contract.
  const _marker: ChainableDriverFactory<PostgresConnectionConfig, PgClient> =
    postgresConnection;

  // (2) the chain types through the factory: each `.connection` accumulates prior connections, the
  //     resolver's `ctx.connections.<prior>` is a THENABLE sibling ORM client, and the entry infers
  //     the driver's own `PgClient` + the resolver's typed args.
  const cfg = defineConfig()
    .connection("main", postgresConnection, { schema: "./main" })
    .connection(
      "replica",
      postgresConnection,
      async (ctx, args: { region: string }) => {
        const main: PgClient = await ctx.connections.main; // sibling client, typed
        void main.select;
        return { schema: `./replica-${args.region}` };
      },
    );

  test("the chained config exposes a typed connect() + the declared connections", () => {
    expect(typeof cfg.connect).toBe("function");
    expect(Object.keys(cfg.connections).sort()).toEqual(["main", "replica"]);
    expect(cfg.connections.main.driver).toBe("postgres");
  });

  test("a FORWARD reference to a not-yet-declared connection is a compile error", () => {
    defineConfig().connection(
      "first",
      postgresConnection,
      // @ts-expect-error — `second` isn't declared yet (order = visibility; no forward refs)
      async (ctx) => ({ schema: `./${await ctx.connections.second}` }),
    );
    expect(true).toBe(true);
  });
});
