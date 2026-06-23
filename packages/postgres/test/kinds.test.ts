import { describe, expect, test } from "bun:test";
import { buildKindDiff, emitKinds } from "@schemic/core";
import {
  option,
  type PortableField,
  record,
  scalar,
} from "@schemic/core/driver";
import type { PgTable } from "../src/emit";
import { type PgConn, postgresDriver } from "../src/index";
import {
  domainPortable,
  enumPortable,
  extensionPortable,
  matViewPortable,
  registry,
  sequencePortable,
  splitTables,
  viewPortable,
} from "../src/kinds";

// The postgres kind registry, post Option-A flip. The driver speaks kinds: explode(authoring) +
// introspectAll feed the generic spine (emitKinds/buildKindDiff). These tests drive that spine
// directly over the driver's table IR (PgTable) -> kind objects (splitTables), and round-trip through
// a real PGlite engine via driver.introspectAll.

const driver = postgresDriver;
const f = (
  name: string,
  type: PortableField["type"],
  extra: Partial<PortableField> = {},
): PortableField => ({ name, table: "", type, ...extra });
const tbl = (
  name: string,
  fields: PortableField[],
  extra: Partial<PgTable> = {},
): PgTable => ({ name, fields, indexes: [], ...extra });
const emitK = (tables: PgTable[]) => emitKinds(registry, splitTables(tables));
const diffK = (a: PgTable[], b: PgTable[]) =>
  buildKindDiff(registry, splitTables(a), splitTables(b));
const ud = (d: { up: string[]; down: string[] }) => ({
  up: d.up,
  down: d.down,
});

// --- registration ------------------------------------------------------------------------------

describe("postgres kind registry", () => {
  test("registers the kinds dependency-ordered (registration order == ordinal == emit order)", () => {
    expect(registry.names()).toEqual([
      "extension",
      "enum",
      "domain",
      "sequence",
      "table",
      "index",
      "constraint",
      "view",
      "matview",
    ]);
    // Pre-table kinds (extension/enum/domain/sequence) FIRST — a table's columns/defaults can reference
    // them; views/matviews LAST — they read tables, so emit after them (reverse on drop).
    expect(registry.ordinal("extension")).toBe(0);
    expect(registry.ordinal("enum")).toBe(1);
    expect(registry.ordinal("domain")).toBe(2);
    expect(registry.ordinal("sequence")).toBe(3);
    expect(registry.ordinal("table")).toBe(4);
    expect(registry.ordinal("index")).toBe(5);
    expect(registry.ordinal("constraint")).toBe(6);
    expect(registry.ordinal("view")).toBe(7);
    expect(registry.ordinal("matview")).toBe(8);
  });
});

// --- emit --------------------------------------------------------------------------------------

describe("emitKinds", () => {
  test("a table maps column types/nullability + implicit id PK", () => {
    const out = emitK([
      tbl("user", [
        f("name", scalar("string")),
        f("age", option(scalar("int"))),
        f("active", scalar("bool")),
      ]),
    ]);
    expect(out).toEqual([
      'CREATE TABLE "user" (\n  "id" text PRIMARY KEY,\n  "active" boolean NOT NULL,\n  "age" integer,\n  "name" text NOT NULL\n);',
    ]);
  });

  test("a unique index emits after its table", () => {
    const out = emitK([
      tbl("user", [f("email", scalar("string"))], {
        indexes: [{ name: "user_email_key", cols: ["email"], unique: true }],
      }),
    ]);
    expect(out).toEqual([
      'CREATE TABLE "user" (\n  "id" text PRIMARY KEY,\n  "email" text NOT NULL\n);',
      'CREATE UNIQUE INDEX "user_email_key" ON "user" ("email");',
    ]);
  });

  test("composite PK + table CHECK (no implicit id)", () => {
    const out = emitK([
      tbl(
        "membership",
        [f("org", scalar("string")), f("user", scalar("string"))],
        { primaryKey: ["org", "user"], checks: ["org <> user"] },
      ),
    ]);
    expect(out[0]).toContain('PRIMARY KEY ("org", "user")');
    expect(out[0]).toContain("CHECK (org <> user)");
    expect(out[0]).not.toContain('"id" text PRIMARY KEY');
  });

  test("cross-table FK emits after BOTH tables (rank-grouped, no clustering)", () => {
    const out = emitK([
      tbl("post", [
        f("title", scalar("string")),
        f("author", record(["user"])),
      ]),
      tbl("user", [f("name", scalar("string"))]),
    ]);
    const fk = out.findIndex((s) => s.includes("ADD CONSTRAINT"));
    expect(
      out.findIndex((s) => s.includes('CREATE TABLE "post"')),
    ).toBeLessThan(fk);
    expect(
      out.findIndex((s) => s.includes('CREATE TABLE "user"')),
    ).toBeLessThan(fk);
    expect(out[fk]).toBe(
      'ALTER TABLE "post" ADD CONSTRAINT "post_author_fkey" FOREIGN KEY ("author") REFERENCES "user" ("id");',
    );
  });

  test("mutual FK resolves (tables first, then both constraints) — the cycle-break", () => {
    const out = emitK([
      tbl("a", [f("b", record(["b"]))]),
      tbl("b", [f("a", record(["a"]))]),
    ]);
    const lastCreate = Math.max(
      out.findIndex((s) => s.includes('CREATE TABLE "a"')),
      out.findIndex((s) => s.includes('CREATE TABLE "b"')),
    );
    expect(out.findIndex((s) => s.includes("ADD CONSTRAINT"))).toBeGreaterThan(
      lastCreate,
    );
  });
});

// --- diff --------------------------------------------------------------------------------------

describe("buildKindDiff up/down", () => {
  const base = [tbl("user", [f("name", scalar("string"))])];

  test("add column", () => {
    const next = [
      tbl("user", [f("name", scalar("string")), f("age", scalar("int"))]),
    ];
    expect(ud(diffK(base, next))).toEqual({
      up: ['ALTER TABLE "user" ADD COLUMN "age" integer NOT NULL;'],
      down: ['ALTER TABLE "user" DROP COLUMN IF EXISTS "age";'],
    });
  });

  test("change column type", () => {
    const prev = [tbl("user", [f("age", scalar("int"))])];
    const next = [tbl("user", [f("age", scalar("float"))])];
    expect(ud(diffK(prev, next))).toEqual({
      up: ['ALTER TABLE "user" ALTER COLUMN "age" TYPE double precision;'],
      down: ['ALTER TABLE "user" ALTER COLUMN "age" TYPE integer;'],
    });
  });

  test("change column nullability", () => {
    const prev = [tbl("user", [f("age", scalar("int"))])];
    const next = [tbl("user", [f("age", option(scalar("int")))])];
    expect(ud(diffK(prev, next))).toEqual({
      up: ['ALTER TABLE "user" ALTER COLUMN "age" DROP NOT NULL;'],
      down: ['ALTER TABLE "user" ALTER COLUMN "age" SET NOT NULL;'],
    });
  });

  test("add table", () => {
    const next = [...base, tbl("tag", [f("label", scalar("string"))])];
    expect(ud(diffK(base, next))).toEqual({
      up: [
        'CREATE TABLE "tag" (\n  "id" text PRIMARY KEY,\n  "label" text NOT NULL\n);',
      ],
      down: ['DROP TABLE IF EXISTS "tag" CASCADE;'],
    });
  });

  test("drop table", () => {
    const prev = [...base, tbl("tag", [f("label", scalar("string"))])];
    expect(ud(diffK(prev, base))).toEqual({
      up: ['DROP TABLE IF EXISTS "tag" CASCADE;'],
      down: [
        'CREATE TABLE "tag" (\n  "id" text PRIMARY KEY,\n  "label" text NOT NULL\n);',
      ],
    });
  });

  test("no change -> empty", () => {
    expect(ud(diffK(base, base))).toEqual({ up: [], down: [] });
  });
});

// --- canonical: emit faithful, rewrite-prone/non-introspected clauses excluded from diffs ------

describe("canonical change-detection", () => {
  const fld = (
    name: string,
    extra: Partial<PortableField> = {},
  ): PortableField => ({ name, table: "t", type: scalar("int"), ...extra });
  const plain = [tbl("t", [fld("n")])];
  const withDefault = [tbl("t", [fld("n", { default: "0" })])];
  const otherDefault = [tbl("t", [fld("n", { default: "5" })])];
  const withComment = [tbl("t", [fld("n", { comment: "count" })])];
  const asFloat = [tbl("t", [fld("n", { type: scalar("float") })])];

  test("DEFAULT add/change is NOT a change", () => {
    expect(ud(diffK(withDefault, otherDefault))).toEqual({ up: [], down: [] });
    expect(ud(diffK(plain, withDefault))).toEqual({ up: [], down: [] });
  });

  test("COMMENT change is NOT a change", () => {
    expect(ud(diffK(plain, withComment))).toEqual({ up: [], down: [] });
  });

  test("but emit stays faithful (DEFAULT + COMMENT DDL produced)", () => {
    const ddl = `${emitK(withDefault).join("\n")}\n${emitK(withComment).join("\n")}`;
    expect(ddl).toContain("DEFAULT 0");
    expect(ddl).toContain("COMMENT ON COLUMN");
  });

  test("a real type change IS detected", () => {
    expect(diffK(plain, asFloat).up.length).toBeGreaterThan(0);
  });
});

// --- displayItems: per-field, grouped under their table (Manuel's decision) ---------------------

describe("displayItems (per-field diff display)", () => {
  test("a column add/type-change surfaces as per-field items under the table", () => {
    const prev = [tbl("user", [f("name", scalar("string"))])];
    const next = [
      tbl("user", [f("name", scalar("string")), f("age", scalar("int"))]),
    ];
    const items = diffK(prev, next).items ?? [];
    const add = items.find((i) => i.key === "field:user:age");
    expect(add?.op).toBe("add");
    expect(add?.kind).toBe("field");
    expect(add?.table).toBe("user");
  });

  test("--full lists every column as a per-field add", () => {
    const full =
      diffK([], [tbl("user", [f("name", scalar("string"))])]).full ?? [];
    expect(full.map((s) => s.key)).toContain("field:user:name");
  });
});

// --- real round-trip via PGlite + introspectAll ------------------------------------------------

describe("introspectAll round-trips through a real engine", () => {
  const roundtrip = async (desired: PgTable[]) => {
    const conn = (await driver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await driver.apply(conn, emitK(desired));
      const live = await driver.introspectAll(conn);
      return buildKindDiff(registry, live, splitTables(desired));
    } finally {
      await conn.close();
    }
  };

  test("tables + FK -> diff empty", async () => {
    const { up, down } = await roundtrip([
      tbl("user", [
        f("name", scalar("string")),
        f("age", option(scalar("int"))),
      ]),
      tbl("post", [
        f("title", scalar("string")),
        f("author", record(["user"])),
      ]),
    ]);
    expect({ up, down }).toEqual({ up: [], down: [] });
  });

  test("clauses (default/check/comment) emit + apply but don't phantom-diff", async () => {
    const { up, down } = await roundtrip([
      tbl("evt", [
        f("label", scalar("string"), { comment: "name" }),
        f("n", scalar("int"), { check: "n > 0", default: "0" }),
      ]),
    ]);
    expect({ up, down }).toEqual({ up: [], down: [] });
  });

  test("a unique index round-trips (introspectAll reads it back)", async () => {
    const { up, down } = await roundtrip([
      tbl("account", [f("email", scalar("string"))], {
        indexes: [{ name: "account_email_key", cols: ["email"], unique: true }],
      }),
    ]);
    expect({ up, down }).toEqual({ up: [], down: [] });
  });
});

// --- enum kind (CREATE TYPE … AS ENUM) ----------------------------------------------------------

describe("enum kind", () => {
  test("emits CREATE TYPE", () => {
    expect(
      emitKinds(registry, [enumPortable("mood", ["happy", "sad"])]),
    ).toEqual([`CREATE TYPE "mood" AS ENUM ('happy', 'sad');`]);
  });

  test("a new enum diffs as an add / drop", () => {
    const { up, down } = buildKindDiff(
      registry,
      [],
      [enumPortable("mood", ["happy", "sad"])],
    );
    expect(up).toEqual([`CREATE TYPE "mood" AS ENUM ('happy', 'sad');`]);
    expect(down).toEqual([`DROP TYPE IF EXISTS "mood";`]);
  });

  test("appended labels -> ALTER TYPE ADD VALUE (not a recreate)", () => {
    const { up } = buildKindDiff(
      registry,
      [enumPortable("mood", ["happy", "sad"])],
      [enumPortable("mood", ["happy", "sad", "ok"])],
    );
    expect(up).toEqual([`ALTER TYPE "mood" ADD VALUE 'ok';`]);
  });

  test("a non-append change falls back to drop+recreate (coarse)", () => {
    const { up } = buildKindDiff(
      registry,
      [enumPortable("mood", ["happy", "sad"])],
      [enumPortable("mood", ["sad", "happy"])],
    );
    expect(up).toEqual([
      `DROP TYPE IF EXISTS "mood";`,
      `CREATE TYPE "mood" AS ENUM ('sad', 'happy');`,
    ]);
  });

  test("enum + a table using it round-trips (CREATE TYPE before CREATE TABLE)", async () => {
    const objs = [
      enumPortable("ert_mood", ["happy", "sad", "ok"]),
      ...splitTables([
        tbl("ert_person", [
          f("name", scalar("string")),
          f("mood", { t: "native", db: "postgres", name: "ert_mood" }),
        ]),
      ]),
    ];
    const ddl = emitKinds(registry, objs);
    expect(ddl[0]).toBe(
      `CREATE TYPE "ert_mood" AS ENUM ('happy', 'sad', 'ok');`,
    );
    expect(ddl[1]).toContain(`CREATE TABLE "ert_person"`);

    const conn = (await driver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await driver.apply(conn, ddl);
      const live = await driver.introspectAll(conn);
      const { up, down } = buildKindDiff(registry, live, objs);
      expect({ up, down }).toEqual({ up: [], down: [] });
    } finally {
      await conn.close();
    }
  });
});

// --- view kind (CREATE VIEW … AS <select>) ------------------------------------------------------

describe("view kind", () => {
  test("emits CREATE VIEW", () => {
    expect(
      emitKinds(registry, [viewPortable("v", 'SELECT id FROM "user"')]),
    ).toEqual([`CREATE VIEW "v" AS SELECT id FROM "user";`]);
  });

  test("a new view diffs as add / drop", () => {
    const { up, down } = buildKindDiff(
      registry,
      [],
      [viewPortable("v", 'SELECT id FROM "user"')],
    );
    expect(up).toEqual([`CREATE VIEW "v" AS SELECT id FROM "user";`]);
    expect(down).toEqual([`DROP VIEW IF EXISTS "v";`]);
  });

  test("body change is NOT a change (pg rewrites view definitions; name-only canonical)", () => {
    const { up, down } = buildKindDiff(
      registry,
      [viewPortable("v", 'SELECT id FROM "user"')],
      [viewPortable("v", 'SELECT id, name FROM "user" WHERE active')],
    );
    expect({ up, down }).toEqual({ up: [], down: [] });
  });

  test("table + view round-trips; view introspected as a view, not a table", async () => {
    const objs = [
      ...splitTables([
        tbl("vrt_user", [
          f("name", scalar("string")),
          f("active", scalar("bool")),
        ]),
      ]),
      viewPortable(
        "vrt_active",
        'SELECT id, name FROM "vrt_user" WHERE active',
      ),
    ];
    const ddl = emitKinds(registry, objs);
    expect(ddl[ddl.length - 1]).toContain('CREATE VIEW "vrt_active"');

    const conn = (await driver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await driver.apply(conn, ddl);
      const live = await driver.introspectAll(conn);
      expect(
        live.some((o) => o.kind === "view" && o.name === "vrt_active"),
      ).toBe(true);
      expect(
        live.some((o) => o.kind === "table" && o.name === "vrt_active"),
      ).toBe(false);
      const { up, down } = buildKindDiff(registry, live, objs);
      expect({ up, down }).toEqual({ up: [], down: [] });
    } finally {
      await conn.close();
    }
  });
});

// --- sequence kind (CREATE SEQUENCE) ------------------------------------------------------------

describe("sequence kind", () => {
  test("emits only the attributes set; pg fills the rest", () => {
    expect(
      emitKinds(registry, [
        sequencePortable("s", { start: "1000", increment: "5", cycle: true }),
      ]),
    ).toEqual([`CREATE SEQUENCE "s" INCREMENT BY 5 START WITH 1000 CYCLE;`]);
    expect(emitKinds(registry, [sequencePortable("plain")])).toEqual([
      `CREATE SEQUENCE "plain";`,
    ]);
  });

  test("a new sequence diffs as add / drop", () => {
    const { up, down } = buildKindDiff(registry, [], [sequencePortable("s")]);
    expect(up).toEqual([`CREATE SEQUENCE "s";`]);
    expect(down).toEqual([`DROP SEQUENCE IF EXISTS "s";`]);
  });

  test("authoring without opts == the fully-defaulted introspected sequence (no phantom)", () => {
    // introspect always reports the materialized defaults; canonical fills them on the authored side.
    const live = sequencePortable("s", {
      start: "1",
      min: "1",
      max: "9223372036854775807",
      increment: "1",
      cache: "1",
      cycle: false,
    });
    const { up, down } = buildKindDiff(
      registry,
      [live],
      [sequencePortable("s")],
    );
    expect({ up, down }).toEqual({ up: [], down: [] });
  });

  test("a real attribute change IS detected (drop+recreate)", () => {
    const { up } = buildKindDiff(
      registry,
      [sequencePortable("s", { increment: "1" })],
      [sequencePortable("s", { increment: "2" })],
    );
    expect(up).toEqual([
      `DROP SEQUENCE IF EXISTS "s";`,
      `CREATE SEQUENCE "s" INCREMENT BY 2;`,
    ]);
  });

  test("default + custom sequence round-trip through the engine", async () => {
    const objs = [
      sequencePortable("krt_plain"),
      sequencePortable("krt_order", {
        start: "1000",
        increment: "5",
        cycle: true,
      }),
    ];
    const conn = (await driver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await driver.apply(conn, emitKinds(registry, objs));
      const live = await driver.introspectAll(conn);
      const { up, down } = buildKindDiff(registry, live, objs);
      expect({ up, down }).toEqual({ up: [], down: [] });
    } finally {
      await conn.close();
    }
  });
});

// --- domain kind (CREATE DOMAIN) ----------------------------------------------------------------

describe("domain kind", () => {
  test("emits CREATE DOMAIN with base + clauses (pg order: DEFAULT, NOT NULL, CHECK)", () => {
    expect(
      emitKinds(registry, [
        domainPortable("email", {
          baseType: "text",
          notNull: true,
          check: "VALUE ~ '@'",
        }),
      ]),
    ).toEqual([`CREATE DOMAIN "email" AS text NOT NULL CHECK (VALUE ~ '@');`]);
  });

  test("a new domain diffs as add / drop", () => {
    const { up, down } = buildKindDiff(
      registry,
      [],
      [domainPortable("email", { baseType: "text" })],
    );
    expect(up).toEqual([`CREATE DOMAIN "email" AS text;`]);
    expect(down).toEqual([`DROP DOMAIN IF EXISTS "email";`]);
  });

  test("CHECK/DEFAULT edits are NOT a change (pg rewrites exprs; excluded from canonical)", () => {
    const { up, down } = buildKindDiff(
      registry,
      [domainPortable("email", { baseType: "text", check: "VALUE ~ '@'" })],
      [
        domainPortable("email", {
          baseType: "text",
          check: "VALUE ~ '@@'",
          default: "'x'",
        }),
      ],
    );
    expect({ up, down }).toEqual({ up: [], down: [] });
  });

  test("varchar base round-trips despite the information_schema spelling", async () => {
    // authored 'varchar(50)' vs introspected 'character varying(50)' -> normalized equal, no phantom.
    const objs = [
      domainPortable("drt_code", { baseType: "varchar(50)", notNull: true }),
      ...splitTables([
        tbl("drt_t", [
          f("code", { t: "native", db: "postgres", name: "drt_code" }),
        ]),
      ]),
    ];
    const conn = (await driver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await driver.apply(conn, emitKinds(registry, objs));
      const live = await driver.introspectAll(conn);
      const { up, down } = buildKindDiff(registry, live, objs);
      expect({ up, down }).toEqual({ up: [], down: [] });
    } finally {
      await conn.close();
    }
  });
});

// --- extension kind (CREATE EXTENSION) ----------------------------------------------------------

describe("extension kind", () => {
  test("emits CREATE EXTENSION IF NOT EXISTS (+ schema/version)", () => {
    expect(emitKinds(registry, [extensionPortable("citext")])).toEqual([
      `CREATE EXTENSION IF NOT EXISTS "citext";`,
    ]);
    expect(
      emitKinds(registry, [
        extensionPortable("vector", { schema: "ext", version: "0.7.0" }),
      ]),
    ).toEqual([
      `CREATE EXTENSION IF NOT EXISTS "vector" SCHEMA "ext" VERSION '0.7.0';`,
    ]);
  });

  test("a new extension diffs as add / drop (name-only canonical)", () => {
    const { up, down } = buildKindDiff(
      registry,
      [],
      [extensionPortable("citext")],
    );
    expect(up).toEqual([`CREATE EXTENSION IF NOT EXISTS "citext";`]);
    expect(down).toEqual([`DROP EXTENSION IF EXISTS "citext";`]);
  });

  test("introspect excludes the plpgsql system default (no phantom on a schema with no extensions)", async () => {
    // PGlite can't install real extensions (citext/postgis aren't bundled), so we can't round-trip a
    // CREATE; assert the introspector never surfaces the always-present plpgsql -> a schema with no
    // authored extensions diffs clean.
    const conn = (await driver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await driver.apply(
        conn,
        emitKinds(
          registry,
          splitTables([tbl("ert_x", [f("a", scalar("string"))])]),
        ),
      );
      const live = await driver.introspectAll(conn);
      expect(live.some((o) => o.kind === "extension")).toBe(false);
    } finally {
      await conn.close();
    }
  });
});

// --- materialized view kind (CREATE MATERIALIZED VIEW) ------------------------------------------

describe("matview kind", () => {
  test("emits CREATE MATERIALIZED VIEW", () => {
    expect(
      emitKinds(registry, [matViewPortable("mv", "SELECT 1 AS x")]),
    ).toEqual([`CREATE MATERIALIZED VIEW "mv" AS SELECT 1 AS x;`]);
  });

  test("body change is NOT a change (name-only canonical, like a view)", () => {
    const { up, down } = buildKindDiff(
      registry,
      [matViewPortable("mv", "SELECT 1 AS x")],
      [matViewPortable("mv", "SELECT 2 AS y")],
    );
    expect({ up, down }).toEqual({ up: [], down: [] });
  });

  test("table + matview round-trips; introspected as a matview", async () => {
    const objs = [
      ...splitTables([tbl("mrt_u", [f("name", scalar("string"))])]),
      matViewPortable("mrt_stats", 'SELECT count(*) AS n FROM "mrt_u"'),
    ];
    const ddl = emitKinds(registry, objs);
    expect(ddl[ddl.length - 1]).toContain(
      'CREATE MATERIALIZED VIEW "mrt_stats"',
    );
    const conn = (await driver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await driver.apply(conn, ddl);
      const live = await driver.introspectAll(conn);
      expect(
        live.some((o) => o.kind === "matview" && o.name === "mrt_stats"),
      ).toBe(true);
      const { up, down } = buildKindDiff(registry, live, objs);
      expect({ up, down }).toEqual({ up: [], down: [] });
    } finally {
      await conn.close();
    }
  });
});
