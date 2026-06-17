import { describe, expect, test } from "bun:test";
import { buildKindDiff, emitKinds } from "@schemic/core";
import {
  option,
  type PortableDb,
  type PortableTable,
  record,
  scalar,
} from "@schemic/core/driver";
import { type PgConn, postgresDriver } from "../src/index";
import { decompose, registry } from "../src/kinds";

// The kind-registry migration (Option-B facade). Proves the postgres `table`/`index`/`constraint`
// engines + `decompose` reproduce the fixed-slot driver's DDL: emitKinds(decompose(db)) vs pgEmit and
// buildKindDiff(decompose(prev), decompose(next)) vs pgDiff. The CLI + PortableDb path stay untouched;
// these tests are the parity bar before the coordinated Option-A flip.

const driver = postgresDriver;
const pdb = (tables: PortableTable[]): PortableDb => ({
  tables,
  functions: [],
  accesses: [],
});
const tbl = (
  name: string,
  fields: PortableTable["fields"],
  extra: Partial<PortableTable> = {},
): PortableTable => ({
  name,
  kind: { kind: "NORMAL" },
  schemafull: true,
  fields,
  indexes: [],
  events: [],
  ...extra,
});
const f = (name: string, type: PortableTable["fields"][number]["type"]) => ({
  name,
  table: "",
  type,
});

const emitK = (db: PortableDb) => emitKinds(registry, decompose(db));
const emitFixed = (db: PortableDb) => driver.emit(db).map((s) => s.ddl);

// --- registration ------------------------------------------------------------------------------

describe("postgres kind registry", () => {
  test("registers table/index/constraint coarse-to-fine (registration order == ordinal)", () => {
    expect(registry.names()).toEqual(["table", "index", "constraint"]);
    expect(registry.ordinal("table")).toBe(0);
    expect(registry.ordinal("index")).toBe(1);
    expect(registry.ordinal("constraint")).toBe(2);
  });
});

// --- emit parity -------------------------------------------------------------------------------

describe("emitKinds parity vs the fixed-slot pgEmit", () => {
  test("single table (columns only) is byte-identical", () => {
    const db = pdb([
      tbl("user", [
        f("name", scalar("string")),
        f("age", option(scalar("int"))),
        f("active", scalar("bool")),
      ]),
    ]);
    expect(emitK(db)).toEqual(emitFixed(db));
  });

  test("single table + unique index is byte-identical (index clusters after its table)", () => {
    const db = pdb([
      tbl("user", [f("email", scalar("string"))], {
        indexes: [{ name: "user_email_key", cols: ["email"], spec: "UNIQUE" }],
      }),
    ]);
    expect(emitK(db)).toEqual(emitFixed(db));
    expect(emitK(db)).toEqual([
      'CREATE TABLE "user" (\n  "id" text PRIMARY KEY,\n  "email" text NOT NULL\n);',
      'CREATE UNIQUE INDEX "user_email_key" ON "user" ("email");',
    ]);
  });

  test("composite PK + table CHECK is byte-identical", () => {
    const db = pdb([
      tbl(
        "membership",
        [f("org", scalar("string")), f("user", scalar("string"))],
        { primaryKey: ["org", "user"], checks: ["org <> user"] },
      ),
    ]);
    expect(emitK(db)).toEqual(emitFixed(db));
  });

  test("cross-table FK is byte-identical (no owner -> rank-grouped: tables, then constraints)", () => {
    const db = pdb([
      tbl("post", [
        f("title", scalar("string")),
        f("author", record(["user"])),
      ]),
      tbl("user", [f("name", scalar("string"))]),
    ]);
    // With `owner` declined, the spine emits all CREATEs then all constraints (by name) — exactly
    // pgEmit's rank grouping. The FK still emits after BOTH its table and the referenced table.
    expect(emitK(db)).toEqual(emitFixed(db));
    const out = emitK(db);
    const fk = out.findIndex((s) => s.includes("ADD CONSTRAINT"));
    expect(
      out.findIndex((s) => s.includes('CREATE TABLE "post"')),
    ).toBeLessThan(fk);
    expect(
      out.findIndex((s) => s.includes('CREATE TABLE "user"')),
    ).toBeLessThan(fk);
  });

  test("mutual FK resolves (tables first, then both constraints) — the cycle-break", () => {
    const db = pdb([
      tbl("a", [f("b", record(["b"]))]),
      tbl("b", [f("a", record(["a"]))]),
    ]);
    const out = emitK(db); // must not throw: constraints depend on tables, not each other
    const lastCreate = Math.max(
      out.findIndex((s) => s.includes('CREATE TABLE "a"')),
      out.findIndex((s) => s.includes('CREATE TABLE "b"')),
    );
    const firstFk = out.findIndex((s) => s.includes("ADD CONSTRAINT"));
    expect(firstFk).toBeGreaterThan(lastCreate);
  });
});

// --- diff parity -------------------------------------------------------------------------------

const diffK = (a: PortableDb, b: PortableDb) =>
  buildKindDiff(registry, decompose(a), decompose(b));
const diffFixed = (a: PortableDb, b: PortableDb) => driver.diff(a, b);
const ud = (d: { up: string[]; down: string[] }) => ({
  up: d.up,
  down: d.down,
});

describe("buildKindDiff parity vs the fixed-slot pgDiff (up/down)", () => {
  const base = pdb([tbl("user", [f("name", scalar("string"))])]);

  test("add column", () => {
    const next = pdb([
      tbl("user", [f("name", scalar("string")), f("age", scalar("int"))]),
    ]);
    expect(ud(diffK(base, next))).toEqual(ud(diffFixed(base, next)));
  });

  test("change column type", () => {
    const prev = pdb([tbl("user", [f("age", scalar("int"))])]);
    const next = pdb([tbl("user", [f("age", scalar("float"))])]);
    expect(ud(diffK(prev, next))).toEqual(ud(diffFixed(prev, next)));
  });

  test("change column nullability", () => {
    const prev = pdb([tbl("user", [f("age", scalar("int"))])]);
    const next = pdb([tbl("user", [f("age", option(scalar("int")))])]);
    expect(ud(diffK(prev, next))).toEqual(ud(diffFixed(prev, next)));
  });

  test("add table", () => {
    const next = pdb([
      tbl("user", [f("name", scalar("string"))]),
      tbl("tag", [f("label", scalar("string"))]),
    ]);
    expect(ud(diffK(base, next))).toEqual(ud(diffFixed(base, next)));
  });

  test("drop table", () => {
    const prev = pdb([
      tbl("user", [f("name", scalar("string"))]),
      tbl("tag", [f("label", scalar("string"))]),
    ]);
    expect(ud(diffK(prev, base))).toEqual(ud(diffFixed(prev, base)));
  });

  test("no change -> empty diff", () => {
    expect(ud(diffK(base, base))).toEqual({ up: [], down: [] });
  });
});

// --- real round-trip via PGlite ----------------------------------------------------------------

describe("kind path round-trips through a real engine", () => {
  test("emitKinds -> PGlite -> introspect -> buildKindDiff is empty", async () => {
    const desired = pdb([
      tbl("user", [
        f("name", scalar("string")),
        f("age", option(scalar("int"))),
      ]),
      tbl("post", [
        f("title", scalar("string")),
        f("author", record(["user"])),
      ]),
    ]);
    const conn = (await driver.connect({
      params: { url: "" },
    } as never)) as PgConn;
    try {
      await driver.apply(conn, emitK(desired));
      const live = await driver.introspect(conn);
      // Compare on the normalized portable form (option->nullable, FK actions canonical), exactly the
      // basis the fixed-slot `equal` uses; the kind diff over it must be empty.
      const a = decompose(driver.normalize(live));
      const b = decompose(driver.normalize(desired));
      const { up, down } = buildKindDiff(registry, a, b);
      expect({ up, down }).toEqual({ up: [], down: [] });
      expect(driver.equal(live, desired)).toBe(true);
    } finally {
      await conn.close();
    }
  });
});
