import { describe, expect, test } from "bun:test";
import type { ConnectionConfigBase } from "@schemic/core/driver";
import { getDriver } from "@schemic/core/driver";
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

  test("single-config resolver -> resolve yields one element", async () => {
    const entry = postgresConnection((c) => ({
      schema: "./schema",
      url: `file:${c.args.dir ?? "/tmp/db"}`,
    }));
    expect(
      resolved(await entry.resolve({ ...ctx, args: { dir: "/data" } })),
    ).toEqual([{ schema: "./schema", url: "file:/data" }]);
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
});
