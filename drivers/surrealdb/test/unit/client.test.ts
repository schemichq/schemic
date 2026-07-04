// The bound ORM client (@schemic/surrealdb/client) P1 — reads. Live-gated on SURREAL_URL (like the
// other live tests). Covers the novel mechanics: BYO wrapping, the pre-bound + awaitable `select`
// (no `.run(db)`), the dispose rule (BYO close = no-op), forkSession, and backward-compat of the
// standalone `select(table).run(conn)` path.

import { describe, expect, test } from "bun:test";
import { defineConfig } from "@schemic/core/config";
import { Surreal } from "surrealdb";
import { z } from "zod";
import { type Client, connect } from "../../src/client";
import { surrealConnection } from "../../src/connection";
import { defineTable, s, surql } from "../../src/index";
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

// Compile-time: a typed surql tag flows its per-statement tuple through db.query.
const _tagTyped = async (db: Client) => {
  const r = await db.query(surql<[number, string[]]>`RETURN 1; RETURN ['a']`);
  const _n: number = r[0];
  const _s: string[] = r[1];
  // .as tuple typing mirrors the decoders positionally:
  const [dn, du] = await db
    .query("RETURN 1; SELECT * FROM orm_user")
    .as([z.number(), User.array()]);
  const _dn: number = dn;
  const _names: string[] = du.map((u) => u.name);
  void [_n, _s, _dn, _names];
};

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

    // SDK-faithful: one entry per statement; a single SELECT's rows are entry [0].
    const out = await db.query<[{ name: string }[]]>(
      "SELECT name, age FROM orm_user ORDER BY name",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(2);
    expect(out[0][0].name).toBe("ada");

    // Multi-statement: NOTHING is dropped.
    const multi = await db.query("RETURN 1; RETURN 2");
    expect(multi).toEqual([1, 2]);

    // .as([...]) mirrors the per-statement shape: one decoder per statement.
    const [typed] = await db
      .query("SELECT * FROM orm_user ORDER BY name")
      .as([User.array()]);
    expect(typed.map((r) => r.name)).toEqual(["ada", "bob"]);

    // Mixed statements decode positionally (scalar via zod, rows via the table codec):
    const [n, users] = await db
      .query("RETURN 1; SELECT * FROM orm_user ORDER BY name")
      .as([z.number(), User.array()]);
    expect(n).toBe(1);
    expect(users.map((r) => r.name)).toEqual(["ada", "bob"]);

    // A zod schema decodes a statement's rows too (parse channel):
    const [picked] = await db
      .query("SELECT name FROM orm_user ORDER BY name")
      .as([User.object.pick({ name: true }).array()]);
    expect(picked.map((r) => r.name)).toEqual(["ada", "bob"]);

    // Decoder-count mismatch = teaching error, never silent picking:
    await expect(
      db.query("RETURN 1; RETURN 2").as([z.number()]),
    ).rejects.toThrow(/one decoder per statement/);
    // User.array() on a scalar statement fails loud, not garbage:
    await expect(db.query("RETURN 1").as([User.array()])).rejects.toThrow(
      /not an array/,
    );

    await c.close();
  });
});

describe.skipIf(!URL)("orm client (P2 writes)", () => {
  test("create -> update(merge/set) -> delete round-trip, decoded end to end", async () => {
    const c = await conn("orm_writes");
    const db = connect(c);

    // CREATE: validated via User.create, returns the decoded created row.
    const ada = await db.create(User).content({ name: "cara", age: 30 });
    expect(String(ada.id.table.name)).toBe("orm_user");
    expect(ada.name).toBe("cara");

    // GET by id: the read half of the chain (row or undefined).
    const fetched = await db.get(User, ada.id);
    expect(fetched?.name).toBe("cara");
    expect(await db.get(User, "missing")).toBeUndefined();

    // UPDATE .merge: deep-merge patch, returns the updated row.
    const older = await db.update(User, ada.id).merge({ age: 31 });
    expect(older.age).toBe(31);
    expect(older.name).toBe("cara"); // merge preserved the rest

    // UPDATE .set: explicit per-field assignment.
    const renamed = await db.update(User, ada.id).set({ name: "cara l." });
    expect(renamed.name).toBe("cara l.");
    expect(renamed.age).toBe(31);

    // .return(projection): the shared cross-driver RETURN surface.
    const picked = await db
      .update(User, ada.id)
      .merge({ age: 32 })
      .return((u) => ({ years: u.age }));
    expect(picked).toEqual({ years: 32 });

    // DELETE: nothing by default; .return("before") hands back the deleted row.
    const gone = await db.delete(User, ada.id).return("before");
    expect(gone.name).toBe("cara l.");
    const rows = await db.select(User).where((u) => u.name.eq("cara l."));
    expect(rows).toHaveLength(0);

    await c.close();
  });

  test("a plain string id targets the STRING record id (no numeric coercion)", async () => {
    const c = await conn("orm_writes_ids");
    const db = connect(c);
    await c.query("CREATE orm_user:s1 SET name = 'sid', age = 5;");
    const updated = await db.update(User, "s1").merge({ age: 99 });
    expect(updated.age).toBe(99);
    await db.delete(User, "s1");
    expect(await db.select(User)).toHaveLength(2); // the two numeric-id seeds remain
    await c.close();
  });

  test("writes work on a forked session too", async () => {
    const c = await conn("orm_writes_session");
    const db = connect(c);
    {
      // Inner scope: the fork disposes BEFORE the parent connection closes.
      await using session = await db.forkSession();
      const row = await session.create(User).content({ name: "sess", age: 1 });
      expect(row.name).toBe("sess");
      await session.delete(User, row.id);
    }
    await c.close();
  });
});

describe("config-as-factory (surrealConnection)", () => {
  test("surrealConnection embeds a lazy client-opener + a ns/db display label", () => {
    const entry = surrealConnection({
      schema: "./x",
      url: "ws://x/rpc",
      namespace: "n",
      database: "d",
    });
    expect(entry.driver).toBe("surrealdb");
    expect(typeof entry.client).toBe("function"); // powers config.connect(name)
    // Dialect display identity for bulk reporting (precedence: config key > this > name[i]):
    const rc = {
      connection: "default",
      params: { url: "ws://x/rpc", namespace: "n", database: "d" },
    };
    expect(entry.label?.(rc as never)).toBe("n/d @ ws://x/rpc");
  });

  test("a parameterized resolver receives its TYPED args as the 2nd param", async () => {
    const entry = surrealConnection((_ctx, args: { region: string }) => ({
      schema: "./x",
      url: `ws://${args.region}.x/rpc`,
      namespace: "n",
      database: "d",
    }));
    const ctx = { env: process.env, connections: {} };
    const bases = await entry.resolve(ctx as never, { region: "eu" });
    expect(bases).toHaveLength(1);
    expect((bases[0] as { url?: string }).url).toBe("ws://eu.x/rpc");
  });

  test("an ARRAY return is a bulk fleet — resolve yields one config per element", async () => {
    const entry = surrealConnection((_ctx, args: { orgs: string[] }) =>
      args.orgs.map((org) => ({
        schema: "./x",
        url: "ws://x/rpc",
        namespace: org,
        database: "app",
        key: org, // display label override for bulk reporting
      })),
    );
    const ctx = { env: process.env, connections: {} };
    const bases = await entry.resolve(ctx as never, { orgs: ["acme", "beta"] });
    expect(bases.map((b) => b.key)).toEqual(["acme", "beta"]);
  });

  test("connect(name, args) types args per connection (compile-time)", () => {
    const schemic = defineConfig({
      connections: {
        fixed: surrealConnection({
          schema: "./x",
          url: "ws://x/rpc",
          namespace: "n",
          database: "d",
        }),
        tenant: surrealConnection(
          (_ctx, args: { region: string; org?: string }) => ({
            schema: "./x",
            url: `ws://${args.region}.x/rpc`,
            namespace: args.org ?? "n",
            database: "d",
          }),
        ),
      },
    });
    // Compile-only (never invoked — no network): args autocomplete + reject per connection.
    const _check = () => {
      void schemic.connect("tenant", { region: "eu", org: "acme" });
      // @ts-expect-error — wrong args shape (region must be a string)
      void schemic.connect("tenant", { region: 5 });
      // @ts-expect-error — a static connection takes no args
      void schemic.connect("fixed", { region: "eu" });
      // @ts-expect-error — unknown connection name
      void schemic.connect("nope");
    };
    expect(typeof _check).toBe("function");
  });

  test.skipIf(!URL)(
    "defineConfig(...).connect(name) opens a typed MANAGED client via the factory",
    async () => {
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
    },
  );
});
