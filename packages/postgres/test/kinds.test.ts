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
import { registry, splitTables } from "../src/kinds";

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
  test("registers table/index/constraint coarse-to-fine (registration order == ordinal)", () => {
    expect(registry.names()).toEqual(["table", "index", "constraint"]);
    expect(registry.ordinal("table")).toBe(0);
    expect(registry.ordinal("index")).toBe(1);
    expect(registry.ordinal("constraint")).toBe(2);
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
