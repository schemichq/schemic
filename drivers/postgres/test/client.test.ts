// @schemic/postgres/client — the P1 ORM client. Proves the pre-bound, awaitable select surface; the
// managed-vs-BYO dispose rule (managed closes, BYO is a no-op); AsyncDisposable; and that the classic
// standalone `select(t).run(conn)` still works (the binding is additive).

import { describe, expect, test } from "bun:test";
import { buildKindDiff, emitKinds } from "@schemic/core";
import { defineSingleton, defineTable, s } from "../src";
import type { SingletonIdOf } from "../src/authoring";
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

describe("postgres ORM client (P2 writes)", () => {
  test("db.create(T).content(data) INSERTs + returns the created row", async () => {
    const conn = await seed();
    try {
      const db = connect(conn);
      const created = await db
        .create(user)
        .content({ id: "u3", name: "Cy", age: 40 });
      expect(created).toEqual({ id: "u3", name: "Cy", age: 40 });
      expect((await db.select(user)).length).toBe(3);
    } finally {
      await conn.close();
    }
  });

  test("db.update(T, id).merge(patch) does a partial UPDATE (only given cols)", async () => {
    const conn = await seed();
    try {
      const db = connect(conn);
      const updated = await db.update(user, "u2").merge({ age: 21 });
      expect(updated).toEqual({ id: "u2", name: "Bo", age: 21 });
      // untouched column stays
      expect((await db.select(user).where((u) => u.id.eq("u2")))[0].name).toBe(
        "Bo",
      );
    } finally {
      await conn.close();
    }
  });

  test("db.update(T, id).content(row) REPLACES every column", async () => {
    const conn = await seed();
    try {
      const db = connect(conn);
      const replaced = await db
        .update(user, "u1")
        .content({ id: "u1", name: "Ada L.", age: 31 });
      expect(replaced).toEqual({ id: "u1", name: "Ada L.", age: 31 });
    } finally {
      await conn.close();
    }
  });

  test("db.delete(T, id) removes the row + returns it; .return('none') returns undefined", async () => {
    const conn = await seed();
    try {
      const db = connect(conn);
      const deleted = await db.delete(user, "u1");
      expect(deleted).toEqual({ id: "u1", name: "Ada", age: 30 });
      expect((await db.select(user)).map((u) => u.id)).toEqual(["u2"]);
      // a no-match delete resolves undefined
      expect(await db.delete(user, "nope")).toBeUndefined();
      // .return("none") -> no RETURNING, resolves undefined
      expect(await db.delete(user, "u2").return("none")).toBeUndefined();
      expect((await db.select(user)).length).toBe(0);
    } finally {
      await conn.close();
    }
  });

  test(".return(projection) re-types + decodes the RETURNING subset", async () => {
    const conn = await seed();
    try {
      const db = connect(conn);
      const row = await db
        .update(user, "u2")
        .merge({ age: 22 })
        .return((u) => ({ who: u.name, years: u.age }));
      expect(row).toEqual({ who: "Bo", years: 22 });
    } finally {
      await conn.close();
    }
  });

  test("validation is FAIL-FAST at the .content/.merge call site (not at await)", async () => {
    const conn = await seed();
    try {
      const db = connect(conn);
      // a bad payload throws SYNCHRONOUSLY at .content(...), before any await
      expect(() =>
        db
          .create(user)
          .content({ id: "x", name: "N", age: "not-a-number" as never }),
      ).toThrow();
      expect(() =>
        db.update(user, "u1").merge({ age: "nope" as never }),
      ).toThrow();
    } finally {
      await conn.close();
    }
  });

  test("standalone create/update/remove run on an explicit conn (unbound builder)", async () => {
    const { create, remove, update } = await import("../src/query");
    const conn = await seed();
    try {
      await create(user).content({ id: "u9", name: "Zed", age: 50 }).run(conn);
      await update(user, "u9").merge({ age: 51 }).run(conn);
      const gone = await remove(user, "u9").run(conn);
      expect(gone).toEqual({ id: "u9", name: "Zed", age: 51 });
      // unbound + no conn -> teaching error
      await expect(
        create(user).content({ id: "z", name: "z", age: 1 }).run(),
      ).rejects.toThrow(/needs a connection/);
    } finally {
      await conn.close();
    }
  });

  test("update/remove reject a composite primary key (use db.query)", async () => {
    const composite = defineTable("membership", {
      orgId: s.text(),
      userId: s.text(),
      role: s.text(),
    }).primaryKey("orgId", "userId");
    const conn = await seed();
    try {
      const db = connect(conn);
      expect(() => db.delete(composite, "x").toSQL()).toThrow(
        /single-column primary key/,
      );
    } finally {
      await conn.close();
    }
  });

  test("IMPLICIT-id table: returned rows CARRY their id (select + update + delete)", async () => {
    // no declared `id` — pg adds the implicit `id text PRIMARY KEY`, outside the declared shape.
    const note = defineTable("note", { title: s.text(), body: s.text() });
    const conn = (await postgresDriver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await postgresDriver.apply(
        conn,
        emitKinds(registry, postgresDriver.explode([note], [])),
      );
      const db = connect(conn);
      // INSERT via the ORM WITHOUT an id — the DB-side default (gen_random_uuid) fills it, and the
      // created row CARRIES the generated id (the full create -> update chain works end to end).
      const created = await db.create(note).content({ title: "T", body: "B" });
      expect(typeof created.id).toBe("string");
      expect(created.id.length).toBeGreaterThan(0);
      const id = created.id;
      // select carries the id (fetched even though it's not a declared field)
      const [row] = await db.select(note);
      expect(row).toEqual({ id, title: "T", body: "B" });
      // the carried id is addressable -> update by it, and the returned row carries it too
      const updated = await db.update(note, id).merge({ title: "T2" });
      expect(updated).toEqual({ id, title: "T2", body: "B" });
      // delete returns the removed row, id and all
      const deleted = await db.delete(note, id);
      expect(deleted).toEqual({ id, title: "T2", body: "B" });
      expect((await db.select(note)).length).toBe(0);
    } finally {
      await conn.close();
    }
  });
});

describe("defineSingleton — DB-enforced one-record tables", () => {
  const appConfig = defineSingleton("app_config", {
    theme: s.text(),
    maxUsers: s.integer(),
  });

  // type marker: SingletonIdOf reads the fixed id literal; a normal table -> never
  type _sglId = SingletonIdOf<typeof appConfig>;
  const _idIsDefault: _sglId = "default"; // compiles: the literal is "default"
  const normal = defineTable("u", { id: s.text().$primaryKey(), n: s.text() });
  // @ts-expect-error — a normal table has no singleton id (never)
  const _notSingleton: SingletonIdOf<typeof normal> = "default";
  // the singleton id LITERAL marker SURVIVES `.use(preset)` (pg carries `id` as a plain field through
  // MergeCols `Omit<F,keyof C> & C`, never re-derived — so a preset can't silently widen it to string).
  const withPreset = appConfig.use(
    defineTable.preset({ columns: { updatedBy: s.text() } }),
  );
  const _stillDefault: SingletonIdOf<typeof withPreset> = "default";
  // @ts-expect-error — still the literal "default" after `.use`, not a widened string
  const _notWide: SingletonIdOf<typeof withPreset> = "x" as string;
  void _idIsDefault;
  void _notSingleton;
  void _stillDefault;
  void _notWide;

  test("emits a DB-enforced one-record table (PK + DEFAULT + CHECK on the literal id)", () => {
    const [ddl] = emitKinds(
      registry,
      postgresDriver.explode([appConfig], []),
    ) as string[];
    expect(ddl).toContain(
      `"id" text PRIMARY KEY DEFAULT 'default' CHECK ("id" = 'default')`,
    );
  });

  test("round-trips with NO phantom diff (canonical = bare implicit id)", async () => {
    const objs = postgresDriver.explode([appConfig], []);
    const conn = (await postgresDriver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await postgresDriver.apply(conn, emitKinds(registry, objs));
      const live = await postgresDriver.introspectAll(conn);
      const { up, down } = buildKindDiff(registry, live, objs);
      expect({ up, down }).toEqual({ up: [], down: [] });
    } finally {
      await conn.close();
    }
  });

  test("create fills the id automatically; the row carries id='default'; single-record enforced", async () => {
    const objs = postgresDriver.explode([appConfig], []);
    const conn = (await postgresDriver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await postgresDriver.apply(conn, emitKinds(registry, objs));
      const db = connect(conn);
      const created = await db
        .create(appConfig)
        .content({ theme: "dark", maxUsers: 5 });
      expect(created).toEqual({ id: "default", theme: "dark", maxUsers: 5 });
      // a second row (any id) is rejected — PK + CHECK make exactly one record possible
      await expect(
        conn.query(
          `INSERT INTO "app_config" ("id","theme","maxUsers") VALUES ('other','x',1);`,
        ),
      ).rejects.toThrow();
      await expect(
        conn.query(
          `INSERT INTO "app_config" ("theme","maxUsers") VALUES ('x',1);`,
        ),
      ).rejects.toThrow();
    } finally {
      await conn.close();
    }
  });

  test("a non-identifier id key throws", () => {
    expect(() =>
      defineSingleton("bad", { x: s.text() }, { id: "no spaces" }),
    ).toThrow(/plain identifier/);
  });

  test("a custom id literal is honored", () => {
    const flags = defineSingleton(
      "flags",
      { on: s.boolean() },
      { id: "singleton" },
    );
    const [ddl] = emitKinds(
      registry,
      postgresDriver.explode([flags], []),
    ) as string[];
    expect(ddl).toContain(
      `"id" text PRIMARY KEY DEFAULT 'singleton' CHECK ("id" = 'singleton')`,
    );
  });
});
