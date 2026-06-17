import { describe, expect, test } from "bun:test";
import { buildKindDiff, emitKinds } from "@schemic/core";
import {
  nullable,
  option,
  type PortableObject,
  type PortableType,
  record,
  scalar,
} from "@schemic/core/driver";
import type { PgTable } from "../src/emit";
import { type PgConn, postgresDriver } from "../src/index";
import { registry, splitTables } from "../src/kinds";

// @schemic/postgres post-flip: drive the kind spine (explode/emitKinds/buildKindDiff/introspectAll)
// over the driver's table IR, apply to a real engine (PGlite), introspect back, and diff. Proves the
// driver stands on the kind-registry contract.

const driver = postgresDriver;
const jsonb: PortableType = { t: "object", fields: {} };

/** Build the driver's table IR from a `{ table: { field: type } }` spec (no indexes). */
function db(spec: Record<string, Record<string, PortableType>>): PgTable[] {
  return Object.entries(spec).map(([name, fields]) => ({
    name,
    indexes: [],
    fields: Object.entries(fields).map(([fname, type]) => ({
      name: fname,
      table: name,
      type,
    })),
  }));
}
const emit = (tables: PgTable[]) => emitKinds(registry, splitTables(tables));
const diff = (a: PgTable[], b: PgTable[]) =>
  buildKindDiff(registry, splitTables(a), splitTables(b));
/** No migration needed between a live introspection and a desired schema. */
const inSync = (live: PortableObject[], desired: PgTable[]) =>
  buildKindDiff(registry, live, splitTables(desired)).up.length === 0;

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
    const out = emit(desired);
    const all = out.join("\n");
    expect(all).toContain('CREATE TABLE "user"');
    expect(all).toContain('"id" text PRIMARY KEY');
    expect(all).toContain('"name" text NOT NULL');
    expect(all).toContain('"age" integer'); // nullable -> no NOT NULL
    expect(all).not.toContain('"age" integer NOT NULL');
    expect(all).toContain('"active" boolean NOT NULL');
    expect(all).toContain('"meta" jsonb NOT NULL');
    expect(all).toContain('"author" text NOT NULL');
    expect(all).toContain("FOREIGN KEY");
    // FK constraint emits after the last CREATE TABLE.
    const fk = out.findIndex((s) => s.includes("ADD CONSTRAINT"));
    const lastCreate = out.reduce(
      (acc, s, i) => (s.startsWith("CREATE TABLE") ? i : acc),
      -1,
    );
    expect(fk).toBeGreaterThan(lastCreate);
  });
});

describe("@schemic/postgres: real round-trip via PGlite", () => {
  test("apply -> introspectAll -> diff is empty (the migration reproduces the schema)", async () => {
    const conn = (await driver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await driver.apply(conn, emit(desired));
      const live = await driver.introspectAll(conn);
      expect(inSync(live, desired)).toBe(true);

      const user = live.find(
        (
          o,
        ): o is PortableObject & {
          fields: { name: string; type: PortableType }[];
        } => o.kind === "table" && o.name === "user",
      );
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

      // The FK is its own kind object referencing user.
      const fk = live.find(
        (o): o is PortableObject & { refTable: string; column: string } =>
          o.kind === "constraint" && o.name === "post_author_fkey",
      );
      expect(fk?.refTable).toBe("user");
      expect(fk?.column).toBe("author");
    } finally {
      await conn.close();
    }
  });

  test("a changed schema is detected (diff is non-empty)", async () => {
    const conn = (await driver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await driver.apply(conn, emit(desired));
      const live = await driver.introspectAll(conn);
      const changed = db({
        user: { name: scalar("string") },
        post: {
          title: scalar("string"),
          author: record(["user"]),
          meta: jsonb,
        },
      });
      expect(inSync(live, changed)).toBe(false);
    } finally {
      await conn.close();
    }
  });
});

describe("@schemic/postgres: field-level diff", () => {
  test("a new table -> CREATE up, DROP down, per-field items", () => {
    const d = diff(
      [],
      db({ user: { name: scalar("string"), active: scalar("bool") } }),
    );
    expect(d.up.join("\n")).toContain('CREATE TABLE "user"');
    expect(d.down.join("\n")).toContain('DROP TABLE IF EXISTS "user"');
    expect(d.items?.length).toBeGreaterThan(0);
  });

  test("dropping an FK-bearing table -> DROP CASCADE up, recreate table-before-FK down", () => {
    const prev = db({
      user: { name: scalar("string") },
      post: { title: scalar("string"), author: record(["user"]) },
    });
    const next = db({ user: { name: scalar("string") } });
    const { up, down } = diff(prev, next);
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
    const { up, down } = diff(prev, next);
    expect(up.join("\n")).toContain('ALTER TABLE "user" ADD COLUMN "age"');
    expect(up.join("\n")).not.toContain("DROP TABLE");
    expect(down.join("\n")).toContain(
      'ALTER TABLE "user" DROP COLUMN IF EXISTS "age"',
    );
  });

  test("adding a column via diff is non-destructive (existing rows survive)", async () => {
    const conn = (await driver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      const base = db({ user: { name: scalar("string") } });
      await driver.apply(conn, emit(base));
      await conn.exec(
        `INSERT INTO "user" ("id", "name") VALUES ('u1', 'Ada');`,
      );

      const next = db({
        user: { name: scalar("string"), age: option(scalar("int")) },
      });
      const d = diff(base, next);
      expect(d.up.join("\n")).toContain("ADD COLUMN");
      expect(d.up.join("\n")).not.toContain("DROP TABLE");
      await driver.apply(conn, d.up);

      const { rows } = await conn.query<{
        id: string;
        name: string;
        age: number | null;
      }>(`SELECT "id", "name", "age" FROM "user";`);
      expect(rows).toEqual([{ id: "u1", name: "Ada", age: null }]);

      const live = await driver.introspectAll(conn);
      expect(inSync(live, next)).toBe(true);
    } finally {
      await conn.close();
    }
  });
});
