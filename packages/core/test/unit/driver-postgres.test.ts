import { describe, expect, test } from "bun:test";
import { schemaStruct } from "../../src/cli/lower";
import { getDriver, liftDb, type PgConn } from "../../src/driver";
import { postgresDriver } from "../../src/driver/postgres";
import { defineTable, s } from "../../src/pure";

// Milestone 3+4 (the spike's thesis): an authored s.* schema, lowered to the PORTABLE IR, can be
// emitted as Postgres DDL, applied to a real Postgres engine (PGlite), introspected back, and
// diffed to ZERO changes. Proves the dialect seam holds for a second, very different database.

const User = defineTable("user", {
  name: s.string(),
  age: s.int().optional(), // option<int>  -> nullable integer column
  bio: s.string().nullable(), // string|null -> nullable text column
  active: s.boolean(),
  score: s.float(),
});

const Post = defineTable("post", {
  title: s.string(),
  author: s.recordId("user"), // record<user> -> text column + FK to "user"
  meta: s.object({ slug: s.string(), draft: s.boolean() }), // -> jsonb
});

// Author once, lift to the portable pivot (this is what surrealDriver.lower does).
const desired = liftDb(schemaStruct([User, Post], []));

describe("postgres driver (Milestone 3): emit", () => {
  test("emits CREATE TABLE with mapped column types, nullability, PK, and FK", () => {
    const ddl = postgresDriver.emit(desired).map((s) => s.ddl);
    const all = ddl.join("\n");
    expect(all).toContain('CREATE TABLE "user"');
    expect(all).toContain('"id" text PRIMARY KEY');
    expect(all).toContain('"name" text NOT NULL');
    expect(all).toContain('"age" integer'); // nullable -> no NOT NULL
    expect(all).not.toContain('"age" integer NOT NULL');
    expect(all).toContain('"active" boolean NOT NULL');
    expect(all).toContain('"meta" jsonb NOT NULL'); // nested object -> jsonb
    expect(all).toContain('"author" text NOT NULL');
    expect(all).toContain("FOREIGN KEY"); // record<user> -> FK
    // FK constraint is ordered after the CREATE TABLEs.
    const kinds = postgresDriver.emit(desired).map((s) => s.kind);
    expect(kinds.indexOf("index")).toBeGreaterThan(kinds.lastIndexOf("table"));
  });
});

describe("postgres driver (Milestone 4): real round-trip via PGlite", () => {
  test("apply -> introspect -> diff is empty (the migration reproduces the schema)", async () => {
    const driver = getDriver("postgres");
    const conn = (await driver.connect({
      db: { url: "" },
    } as never)) as PgConn;
    try {
      const ddl = driver.emit(desired).map((s) => s.ddl);
      await driver.apply(conn, ddl);

      const live = await driver.introspect(conn);
      // The diff core's comparison: structured equality over the normalized portable IR.
      expect(driver.equal(desired, live)).toBe(true);

      // And concretely: the live schema has both tables with the expected portable column types.
      const norm = driver.normalize(live);
      const user = norm.tables.find((t) => t.name === "user");
      const byName = new Map(user?.fields.map((f) => [f.name, f.type]));
      // option<int> and string|null BOTH land as nullable (the documented Postgres collapse).
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
    const conn = (await driver.connect({ db: { url: "" } } as never)) as PgConn;
    try {
      await driver.apply(
        conn,
        driver.emit(desired).map((s) => s.ddl),
      );
      const live = await driver.introspect(conn);
      // Author a schema missing a column — must NOT compare equal to the live DB.
      const changed = liftDb(
        schemaStruct([defineTable("user", { name: s.string() }), Post], []),
      );
      expect(driver.equal(changed, live)).toBe(false);
    } finally {
      await conn.close();
    }
  });
});
