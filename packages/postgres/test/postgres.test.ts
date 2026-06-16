import { describe, expect, test } from "bun:test";
import {
  getDriver,
  nullable,
  option,
  type PortableDb,
  type PortableType,
  record,
  scalar,
} from "@schemic/core/driver";
import { type PgConn, postgresDriver } from "../src/index";

// @schemic/postgres in isolation: build the PORTABLE IR directly (no surreal authoring), emit
// Postgres DDL, apply it to a real engine (PGlite), introspect back, and diff. Proves the driver
// stands alone on the neutral @schemic/core/driver SDK.

const jsonb: PortableType = { t: "object", fields: {} };

/** Build a portable DB from a `{ table: { field: type } }` spec (all NORMAL, schemafull, no idx/events). */
function db(spec: Record<string, Record<string, PortableType>>): PortableDb {
  return {
    tables: Object.entries(spec).map(([name, fields]) => ({
      name,
      kind: { kind: "NORMAL" },
      schemafull: true,
      indexes: [],
      events: [],
      fields: Object.entries(fields).map(([fname, type]) => ({
        name: fname,
        table: name,
        type,
      })),
    })),
    functions: [],
    accesses: [],
  };
}

const desired = db({
  user: {
    name: scalar("string"),
    age: option(scalar("int")), // option<int>  -> nullable integer column
    bio: nullable(scalar("string")), // string|null -> nullable text column
    active: scalar("bool"),
    score: scalar("float"),
  },
  post: {
    title: scalar("string"),
    author: record(["user"]), // record<user> -> text column + FK to "user"
    meta: jsonb, // nested object -> jsonb
  },
});

describe("@schemic/postgres: emit", () => {
  test("emits CREATE TABLE with mapped column types, nullability, PK, and FK", () => {
    const all = postgresDriver
      .emit(desired)
      .map((s) => s.ddl)
      .join("\n");
    expect(all).toContain('CREATE TABLE "user"');
    expect(all).toContain('"id" text PRIMARY KEY');
    expect(all).toContain('"name" text NOT NULL');
    expect(all).toContain('"age" integer'); // nullable -> no NOT NULL
    expect(all).not.toContain('"age" integer NOT NULL');
    expect(all).toContain('"active" boolean NOT NULL');
    expect(all).toContain('"meta" jsonb NOT NULL');
    expect(all).toContain('"author" text NOT NULL');
    expect(all).toContain("FOREIGN KEY");
    const kinds = postgresDriver.emit(desired).map((s) => s.kind);
    expect(kinds.indexOf("fk")).toBeGreaterThan(kinds.lastIndexOf("table"));
  });
});

describe("@schemic/postgres: real round-trip via PGlite", () => {
  test("apply -> introspect -> diff is empty (the migration reproduces the schema)", async () => {
    const driver = getDriver("postgres");
    const conn = (await driver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await driver.apply(
        conn,
        driver.emit(desired).map((s) => s.ddl),
      );
      const live = await driver.introspect(conn);
      expect(driver.equal(desired, live)).toBe(true);

      const norm = driver.normalize(live);
      const user = norm.tables.find((t) => t.name === "user");
      const byName = new Map(user?.fields.map((f) => [f.name, f.type]));
      expect(byName.get("age")).toEqual({
        t: "nullable",
        inner: { t: "scalar", name: "int" },
      });
      expect(byName.get("bio")).toEqual({
        t: "nullable",
        inner: { t: "scalar", name: "string" },
      });
      expect(byName.get("name")).toEqual({ t: "scalar", name: "string" });

      const post = norm.tables.find((t) => t.name === "post");
      const postByName = new Map(post?.fields.map((f) => [f.name, f.type]));
      expect(postByName.get("author")).toEqual({
        t: "record",
        tables: ["user"],
      });
      expect(postByName.get("meta")).toEqual({ t: "object", fields: {} });
    } finally {
      await conn.close();
    }
  });

  test("a changed schema is detected as not-equal (no false negative)", async () => {
    const driver = getDriver("postgres");
    const conn = (await driver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await driver.apply(
        conn,
        driver.emit(desired).map((s) => s.ddl),
      );
      const live = await driver.introspect(conn);
      const changed = db({
        user: { name: scalar("string") },
        post: desiredPost(),
      });
      expect(driver.equal(changed, live)).toBe(false);
    } finally {
      await conn.close();
    }
  });
});

function desiredPost(): Record<string, PortableType> {
  return { title: scalar("string"), author: record(["user"]), meta: jsonb };
}

describe("@schemic/postgres: field-level diff", () => {
  test("a new table -> CREATE up, DROP down", () => {
    const diff = postgresDriver.diff(
      { tables: [], functions: [], accesses: [] },
      db({ user: { name: scalar("string"), active: scalar("bool") } }),
    );
    expect(diff.up.join("\n")).toContain('CREATE TABLE "user"');
    expect(diff.down.join("\n")).toContain('DROP TABLE IF EXISTS "user"');
    expect(diff.items?.length).toBeGreaterThan(0);
  });

  test("dropping an FK-bearing table -> DROP CASCADE up, recreate table-before-FK down", () => {
    const prev = db({
      user: { name: scalar("string") },
      post: { title: scalar("string"), author: record(["user"]) },
    });
    const next = db({ user: { name: scalar("string") } });
    const { up, down } = postgresDriver.diff(prev, next);
    expect(up.join("\n")).toContain('DROP TABLE IF EXISTS "post" CASCADE');
    const downTable = down.findIndex((s) => s.includes('CREATE TABLE "post"'));
    const downFk = down.findIndex((s) => s.includes("ADD CONSTRAINT"));
    expect(downTable).toBeGreaterThanOrEqual(0);
    expect(downFk).toBeGreaterThanOrEqual(0);
    expect(downTable).toBeLessThan(downFk);
  });

  test("adding a column -> ALTER TABLE ADD COLUMN (no table drop)", () => {
    const prev = db({ user: { name: scalar("string") } });
    const next = db({
      user: { name: scalar("string"), age: option(scalar("int")) },
    });
    const { up, down } = postgresDriver.diff(prev, next);
    expect(up.join("\n")).toContain('ALTER TABLE "user" ADD COLUMN "age"');
    expect(up.join("\n")).not.toContain("DROP TABLE");
    expect(down.join("\n")).toContain(
      'ALTER TABLE "user" DROP COLUMN IF EXISTS "age"',
    );
  });

  test("adding a column via diff is non-destructive (existing rows survive)", async () => {
    const driver = getDriver("postgres");
    const conn = (await driver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      const base = db({ user: { name: scalar("string") } });
      await driver.apply(
        conn,
        driver.emit(base).map((s) => s.ddl),
      );
      await conn.exec(
        `INSERT INTO "user" ("id", "name") VALUES ('u1', 'Ada');`,
      );

      const next = db({
        user: { name: scalar("string"), age: option(scalar("int")) },
      });
      const diff = driver.diff(base, next);
      expect(diff.up.join("\n")).toContain("ADD COLUMN");
      expect(diff.up.join("\n")).not.toContain("DROP TABLE");
      await driver.apply(conn, diff.up);

      const { rows } = await conn.query<{
        id: string;
        name: string;
        age: number | null;
      }>(`SELECT "id", "name", "age" FROM "user";`);
      expect(rows).toEqual([{ id: "u1", name: "Ada", age: null }]);

      const live = await driver.introspect(conn);
      expect(driver.equal(next, live)).toBe(true);
    } finally {
      await conn.close();
    }
  });
});
