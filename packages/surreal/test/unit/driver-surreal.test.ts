import { describe, expect, test } from "bun:test";
import { getDriver, nullable, option, scalar } from "@schemic/core";
import { schemaStruct } from "../../src/cli/lower";
import { emitStatements } from "../../src/ddl";
import { surrealDriver } from "../../src/driver/surreal";
import { liftDb } from "../../src/driver/surreal-ir";
import { defineFunction, defineTable, s } from "../../src/pure";

// Milestone 1: prove the Driver seam is real and behavior-preserving — the Surreal driver's pure ops
// (lower / emit / normalize / equal) delegate to the existing functions and round-trip. No live DB.

const User = defineTable("user", {
  name: s.string(),
  age: s.int().optional(),
});
const Post = defineTable("post", { title: s.string() });
const greet = defineFunction("greet", { name: s.string() });

describe("surrealDriver (Milestone 1 seam)", () => {
  test("is registered under its name", () => {
    expect(getDriver("surreal")).toBe(surrealDriver);
    expect(surrealDriver.name).toBe("surreal");
  });

  test("lower delegates to schemaStruct, lifted to the portable IR", () => {
    const viaDriver = surrealDriver.lower([User, Post], []);
    const direct = liftDb(schemaStruct([User, Post], []));
    expect(viaDriver).toEqual(direct);
  });

  test("emit produces ordered canonical DDL from the IR", () => {
    const struct = surrealDriver.lower([User], [greet]);
    const stmts = surrealDriver.emit(struct);
    // Ordering: db-level function first, then table, then fields.
    expect(stmts.map((s) => s.kind)).toEqual([
      "function",
      "table",
      "field",
      "field",
    ]);
    const ddl = stmts.map((s) => s.ddl).join("\n");
    expect(ddl).toContain("DEFINE TABLE user TYPE NORMAL SCHEMAFULL");
    expect(ddl).toContain("DEFINE FIELD name ON TABLE user TYPE string");
    expect(ddl).toContain("DEFINE FIELD age ON TABLE user TYPE option<int>");
  });

  test("emit reproduces the existing emitStatements DDL set for a fresh table", () => {
    const struct = surrealDriver.lower([User], []);
    const driverDdls = new Set(
      surrealDriver.emit(struct).map((s) => s.ddl.trim()),
    );
    // The canonical emitter (IR->DDL) and the authoring emitter (TableDef->DDL) agree on the
    // statement set for a from-scratch table (no IF NOT EXISTS / OVERWRITE).
    const authoringDdls = emitStatements(User).map((s) => s.ddl.trim());
    for (const ddl of authoringDdls) expect(driverDdls.has(ddl)).toBe(true);
  });

  test("emit honors overwrite", () => {
    const struct = surrealDriver.lower([Post], []);
    const ddl = surrealDriver
      .emit(struct, { overwrite: true })
      .map((s) => s.ddl);
    expect(ddl.every((d) => d.includes("OVERWRITE"))).toBe(true);
  });

  test("equal: a schema equals itself, differs from a changed one", () => {
    const a = surrealDriver.lower([User], []);
    const b = surrealDriver.lower([User], []);
    const c = surrealDriver.lower(
      [defineTable("user", { name: s.string() })],
      [],
    );
    expect(surrealDriver.equal(a, b)).toBe(true);
    expect(surrealDriver.equal(a, c)).toBe(false); // dropped the `age` field
  });
});

describe("portable type model (Milestone 2 keystone)", () => {
  test("option<any> collapses to any", () => {
    expect(option(scalar("any"))).toEqual(scalar("any"));
  });

  test("option and nullable are distinct", () => {
    expect(option(scalar("int"))).not.toEqual(nullable(scalar("int")));
  });

  test("nullable(option(X)) folds to option(nullable(X)) — .optional().nullable() == .nullish()", () => {
    expect(nullable(option(scalar("string")))).toEqual(
      option(nullable(scalar("string"))),
    );
  });
});
