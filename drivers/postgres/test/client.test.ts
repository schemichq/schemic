// @schemic/postgres/client — the P1 ORM client. Proves the pre-bound, awaitable select surface; the
// managed-vs-BYO dispose rule (managed closes, BYO is a no-op); AsyncDisposable; and that the classic
// standalone `select(t).run(conn)` still works (the binding is additive).

import { describe, expect, test } from "bun:test";
import { emitKinds } from "@schemic/core";
import { defineTable, s } from "../src";
import { connect, PgClient } from "../src/client";
import type { PgConn } from "../src/connection";
import { postgresDriver } from "../src/driver";
import { registry } from "../src/kinds";
import { select } from "../src/query";

const user = defineTable("app_user", {
  id: s.text().$primaryKey(),
  name: s.text(),
  age: s.integer(),
});

async function seed(): Promise<PgConn> {
  const conn = (await postgresDriver.connect({
    params: { url: "" },
  } as never)) as PgConn;
  await postgresDriver.apply(
    conn,
    emitKinds(registry, postgresDriver.explode([user], [])),
  );
  await conn.query(
    `INSERT INTO "app_user" ("id","name","age") VALUES ('u1','Ada',30),('u2','Bo',15);`,
  );
  return conn;
}

describe("postgres ORM client (P1)", () => {
  test("BYO connect(conn): db.select is pre-bound + awaitable (decoded rows)", async () => {
    const conn = await seed();
    try {
      const db = connect(conn); // BYO -> synchronous
      expect(db).toBeInstanceOf(PgClient);
      const all = await db.select(user);
      expect(all.map((u) => u.name).sort()).toEqual(["Ada", "Bo"]);
      const adults = await db
        .select(user)
        .where((u) => u.age.gt(18))
        .return((u) => ({ n: u.name }));
      expect(adults).toEqual([{ n: "Ada" }]);
      // no-arg .run() on a bound query also works
      expect((await db.select(user).limit(1).run()).length).toBe(1);
    } finally {
      await conn.close();
    }
  });

  test("BYO close() is a NO-OP — the user's connection stays open", async () => {
    const conn = await seed();
    try {
      const db = connect(conn);
      await db.close(); // must NOT close a connection the user owns
      const { rows } = await conn.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM "app_user";`,
      );
      expect(rows[0].n).toBe(2); // still usable
    } finally {
      await conn.close();
    }
  });

  test("managed close() DOES close the connection it owns", async () => {
    const conn = await seed();
    const db = PgClient.managed(conn); // owns `conn`
    await db.close();
    // after close, the underlying PGlite is closed -> a query fails
    await expect(conn.query(`SELECT 1;`)).rejects.toThrow();
  });

  test("AsyncDisposable: [Symbol.asyncDispose] === close (managed closes; BYO no-op)", async () => {
    // managed
    const c1 = await seed();
    const managed = PgClient.managed(c1);
    await managed[Symbol.asyncDispose]();
    await expect(c1.query(`SELECT 1;`)).rejects.toThrow();
    // BYO
    const c2 = await seed();
    try {
      const byo = connect(c2);
      await byo[Symbol.asyncDispose]();
      expect((await c2.query(`SELECT 1 AS x;`)).rows[0]).toEqual({ x: 1 });
    } finally {
      await c2.close();
    }
  });

  test("backward-compatible: standalone select(t).run(conn) still works; unbound await throws", async () => {
    const conn = await seed();
    try {
      expect((await select(user).run(conn)).length).toBe(2);
      // an UNBOUND query (no conn) rejects with a clear message — via await or .run()
      await expect(select(user).run()).rejects.toThrow(/needs a connection/);
      await expect((async () => await select(user))()).rejects.toThrow(
        /needs a connection/,
      );
    } finally {
      await conn.close();
    }
  });

  test("db.query(sql, params?): raw by default; .as(table)/.as(schema) decodes; thenable", async () => {
    const conn = await seed();
    try {
      const db = connect(conn);
      // RAW by default (no decode — arbitrary statement)
      const raw = await db.query(`SELECT count(*)::int AS n FROM "app_user";`);
      expect(raw).toEqual([{ n: 2 }]);
      // params bind positionally
      const one = await db.query(`SELECT name FROM "app_user" WHERE id = $1;`, [
        "u1",
      ]);
      expect(one).toEqual([{ name: "Ada" }]);
      // .as(table) -> decode each row through the table's row codec (typed App rows)
      const rows = await db
        .query(`SELECT * FROM "app_user" ORDER BY id;`)
        .as(user);
      expect(rows.map((r) => r.name)).toEqual(["Ada", "Bo"]);
      expect(typeof rows[0].age).toBe("number");
      // .as(schema) -> any Standard-Schema (a picked subset here)
      const picked = await db
        .query(`SELECT name FROM "app_user" WHERE id = 'u1';`)
        .as(user.object.pick({ name: true }));
      expect(picked).toEqual([{ name: "Ada" }]);
      // .toSQL() renders without executing
      expect(db.query(`SELECT 1;`).toSQL()).toEqual({
        sql: `SELECT 1;`,
        params: [],
      });
    } finally {
      await conn.close();
    }
  });
});
