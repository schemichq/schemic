// The bound ORM client (@schemic/surrealdb/client) P1 — reads. Live-gated on SURREAL_URL (like the
// other live tests). Covers the novel mechanics: BYO wrapping, the pre-bound + awaitable `select`
// (no `.run(db)`), the dispose rule (BYO close = no-op), forkSession, and backward-compat of the
// standalone `select(table).run(conn)` path.

import { describe, expect, test } from "bun:test";
import { defineConfig } from "@schemic/core/config";
import { Surreal } from "surrealdb";
import { connect } from "../../src/client";
import { surrealConnection } from "../../src/connection";
import { defineTable, s } from "../../src/index";
import { select } from "../../src/query";

const URL = process.env.SURREAL_URL;
const User = defineTable("orm_user", { name: s.string(), age: s.int() });

async function conn(ns: string): Promise<Surreal> {
  const c = new Surreal();
  await c.connect(URL as string);
  await c.signin({ username: "root", password: "root" });
  await c.use({ namespace: ns, database: ns });
  await c.query(
    "REMOVE TABLE IF EXISTS orm_user; CREATE orm_user:1 SET name='ada', age=36; CREATE orm_user:2 SET name='bob', age=20;",
  );
  return c;
}

describe.skipIf(!URL)("orm client (P1 reads)", () => {
  test("connect(client) is BYO; bound select is awaitable (no .run) + chains", async () => {
    const c = await conn("orm_byo");
    const db = connect(c); // BYO — synchronous, wraps the existing conn

    const rows = await db.select(User); // awaitable, pre-bound
    expect(rows.length).toBe(2);

    const adults = await db
      .select(User)
      .where((u) => u.age.gte(18))
      .orderBy((u) => u.name);
    expect(adults.map((r) => r.name)).toEqual(["ada", "bob"]);

    const one = await db.select(User).where((u) => u.name.eq("ada"));
    expect(one).toHaveLength(1);
    expect(one[0].age).toBe(36);

    await db.close(); // BYO close = NO-OP: the conn stays open
    const [after] = await c.query("SELECT * FROM orm_user");
    expect(after).toBeDefined();
    await c.close();
  });

  test("forkSession gives a disposable session with the same bound reads", async () => {
    const c = await conn("orm_fork");
    const db = connect(c);
    const session = await db.forkSession();
    expect(typeof session[Symbol.asyncDispose]).toBe("function");
    const rows = await session.select(User);
    expect(rows.length).toBe(2);
    await session.close(); // disposes the fork, not the parent conn
    await c.close();
  });

  test("the dispose method is wired (close)", async () => {
    const c = await conn("orm_dispose");
    const db = connect(c);
    expect(typeof db[Symbol.asyncDispose]).toBe("function");
    await db[Symbol.asyncDispose](); // BYO -> no-op
    expect((await c.query("SELECT * FROM orm_user"))[0]).toBeDefined();
    await c.close();
  });

  test("standalone select(table).run(conn) still works (backward-compat)", async () => {
    const c = await conn("orm_standalone");
    const rows = await select(User).run(c);
    expect(rows.length).toBe(2);
    await c.close();
  });

  test("awaiting an UNBOUND select rejects with clear guidance", async () => {
    let err: unknown;
    try {
      await select(User); // no bound conn -> the `then` runs -> `run()` throws
    } catch (e) {
      err = e;
    }
    expect(String(err)).toMatch(/not bound to a connection/);
  });

  test("managed connect() reaches the resolver (throws on a missing connection)", async () => {
    // No project config in cwd -> resolveConnection throws clearly, proving the managed path is wired.
    await expect(connect("definitely_not_a_connection")).rejects.toThrow();
  });

  test("db.query is a raw escape hatch; .as(schema) opts into decode", async () => {
    const c = await conn("orm_rawq");
    const db = connect(c);

    const raw = await db.query("SELECT name, age FROM orm_user ORDER BY name");
    expect(raw).toHaveLength(2);
    expect((raw[0] as { name: string }).name).toBe("ada");

    // .as(table) -> full decode through the table codec:
    const typed = await db
      .query("SELECT * FROM orm_user ORDER BY name")
      .as(User);
    expect(typed.map((r) => r.name)).toEqual(["ada", "bob"]);

    // .as(zod schema) -> parse each row (User.object.pick(...)):
    const picked = await db
      .query("SELECT name FROM orm_user ORDER BY name")
      .as(User.object.pick({ name: true }));
    expect(picked.map((r) => r.name)).toEqual(["ada", "bob"]);

    await c.close();
  });
});

describe.skipIf(!URL)("config-as-factory (surrealConnection)", () => {
  test("surrealConnection embeds a lazy client-opener + optional args schema", () => {
    const argsSchema = s.object({ tenant: s.string() });
    const entry = surrealConnection(
      { schema: "./x", url: "ws://x/rpc", namespace: "n", database: "d" },
      { args: argsSchema },
    );
    expect(entry.driver).toBe("surrealdb");
    expect(typeof entry.client).toBe("function"); // powers config.connect(name)
    expect(entry.args).toBe(argsSchema);
  });

  test("defineConfig(...).connect(name) opens a typed MANAGED client via the factory", async () => {
    const schemic = defineConfig({
      connections: {
        default: surrealConnection({
          schema: "./_unused_for_connect",
          url: URL as string,
          namespace: "orm_factory",
          database: "orm_factory",
          username: "root",
          password: "root",
          authLevel: "root",
        }),
      },
    });
    const db = await schemic.connect("default"); // MANAGED — the factory's client-opener runs
    await db.query(
      "REMOVE TABLE IF EXISTS orm_user; CREATE orm_user:1 SET name='z', age=1;",
    );
    const rows = await db.select(User);
    expect(rows).toHaveLength(1);
    await db.close(); // managed -> closes the connection it opened
  });
});
