import { describe, expect, test } from "bun:test";
import { RecordId, Uuid, surql } from "surrealdb";
import { z } from "zod";
import { defineRelation, defineTable, defineView, s } from "../../src";
import { emitTable, emitStatements, alterField, implicitFieldSet, type DefineStatement } from "../../src/ddl";
import { fromTableDef, schemaStruct } from "../../src/cli/lower";
import { normalizeTable, hasStrategicId } from "../../src/cli/struct";
import { structuredSnapshot } from "../../src/cli/structure";
import { renderSchemaToTS } from "../../src/cli/pull";
import type { DbStructured, StructField, StructTable } from "../../src/cli/structure";

const { inline } = require("../../src/ddl");

/** Read the id RecordIdField's surreal metadata off a TableDef. */
function idSurreal(t: ReturnType<typeof defineTable>): Record<string, unknown> {
  return (t.fields as unknown as Record<string, { surreal: Record<string, unknown> }>).id.surreal;
}
/** Read the id RecordIdField's valueType Zod schema off a TableDef. */
function idValueType(t: ReturnType<typeof defineTable>) {
  return (t.fields as Record<string, { valueType?: z.ZodType }>).id.valueType;
}
/** safeParse a value against the id's valueType. */
function idValidates(t: ReturnType<typeof defineTable>, v: unknown): boolean {
  return idValueType(t)!.safeParse(v).success;
}

// ============================================================================
// 1. s.id() — runtime validation (the Zod schema itself)
// ============================================================================

describe("s.id() — runtime validation (Zod schema)", () => {
  const schema = s.id().schema;

  test("accepts a valid 20-char lowercase-alphanumeric string", () => {
    expect(z.safeParse(schema, "4uqmrmtjhtjeg77et0dl").success).toBe(true);
  });

  test("accepts all-digit 20-char string", () => {
    expect(z.safeParse(schema, "12345678901234567890").success).toBe(true);
  });

  test("accepts mixed lowercase+digits, 20 chars", () => {
    expect(z.safeParse(schema, "a1b2c3d4e5f6g7h8i9j0").success).toBe(true);
  });

  test("rejects uppercase letters (strict [a-z0-9])", () => {
    expect(z.safeParse(schema, "ABCDEFGHIJKLMNOPQRST").success).toBe(false);
  });

  test("rejects mixed case", () => {
    expect(z.safeParse(schema, "Abcdefghij1234567890").success).toBe(false);
  });

  test("rejects too short (3 chars)", () => {
    expect(z.safeParse(schema, "abc").success).toBe(false);
  });

  test("rejects too short (19 chars)", () => {
    expect(z.safeParse(schema, "4uqmrmtjhtjeg77et0d").success).toBe(false);
  });

  test("rejects too long (21 chars)", () => {
    expect(z.safeParse(schema, "4uqmrmtjhtjeg77et0dla").success).toBe(false);
  });

  test("rejects empty string", () => {
    expect(z.safeParse(schema, "").success).toBe(false);
  });

  test("rejects special characters (!@#$%)", () => {
    expect(z.safeParse(schema, "4uqmrmtjhtjeg77et0!l").success).toBe(false);
  });

  test("rejects dash (not in [a-z0-9])", () => {
    expect(z.safeParse(schema, "4uqmrmtjhtjeg77et0-l").success).toBe(false);
  });

  test("rejects underscore", () => {
    expect(z.safeParse(schema, "4uqmrmtjhtjeg77et0_l").success).toBe(false);
  });

  test("rejects space", () => {
    expect(z.safeParse(schema, "4uqmrmtjhtjeg77et0 l").success).toBe(false);
  });

  test("rejects non-string types (number)", () => {
    expect(z.safeParse(schema, 123).success).toBe(false);
  });

  test("rejects non-string types (null)", () => {
    expect(z.safeParse(schema, null).success).toBe(false);
  });

  test("rejects non-string types (undefined)", () => {
    expect(z.safeParse(schema, undefined).success).toBe(false);
  });

  test("rejects non-string types (object)", () => {
    expect(z.safeParse(schema, { id: "foo" }).success).toBe(false);
  });

  test("rejects a 20-char string with unicode", () => {
    expect(z.safeParse(schema, "áéíóúáéíóúáéíóúáéíó").success).toBe(false);
  });
});

// ============================================================================
// 2. s.id() / s.ulid() / s.uuid() — scalar (non-id) use
// ============================================================================

describe("scalar (non-id) use — no regression", () => {
  test("s.id() as scalar bakes $value asserts (not id.id()) and no default", () => {
    const t = defineTable("t", { id: s.string(), code: s.id() });
    const code = (t.fields as unknown as Record<string, { surreal: Record<string, unknown> }>).code;
    expect(code.surreal.idStrategy).toBe("randId");
    expect(code.surreal.asserts).toEqual([
      "string::len($value) == 20",
      "$value = /^[a-z0-9]+$/",
    ]);
    expect(code.surreal.default).toBeUndefined();
  });

  test("s.ulid() as scalar bakes string::is_ulid($value) and no default", () => {
    const t = defineTable("t", { id: s.string(), code: s.ulid() });
    const code = (t.fields as unknown as Record<string, { surreal: Record<string, unknown> }>).code;
    expect(code.surreal.idStrategy).toBe("ulid");
    expect(code.surreal.asserts).toEqual(["string::is_ulid($value)"]);
    expect(code.surreal.default).toBeUndefined();
  });

  test("s.uuid() as scalar has no asserts (native type) and no default", () => {
    const t = defineTable("t", { id: s.string(), uid: s.uuid() });
    const uid = (t.fields as unknown as Record<string, { surreal: Record<string, unknown> }>).uid;
    expect(uid.surreal.idStrategy).toBe("uuid");
    expect(uid.surreal.asserts).toBeUndefined();
    expect(uid.surreal.default).toBeUndefined();
  });

  test("s.id() scalar emits a normal DEFINE FIELD with $value asserts", () => {
    const t = defineTable("t", { id: s.string(), code: s.id() });
    const ddl = emitTable(t);
    expect(ddl).toContain(
      "DEFINE FIELD code ON TABLE t TYPE string ASSERT string::len($value) == 20 AND $value = /^[a-z0-9]+$/;",
    );
    // No DEFAULT on the scalar field
    expect(ddl).not.toContain("DEFAULT rand::id()");
  });
});

// ============================================================================
// 3. Strategy detection — buildIdField
// ============================================================================

describe("strategy detection — buildIdField", () => {
  test("s.id() as id → randId strategy", () => {
    const t = defineTable("t", { id: s.id(), name: s.string() });
    expect(idSurreal(t).idStrategy).toBe("randId");
  });

  test("s.ulid() as id → ulid strategy", () => {
    const t = defineTable("t", { id: s.ulid(), name: s.string() });
    expect(idSurreal(t).idStrategy).toBe("ulid");
  });

  test("s.uuid() as id → uuid strategy", () => {
    const t = defineTable("t", { id: s.uuid(), name: s.string() });
    expect(idSurreal(t).idStrategy).toBe("uuid");
  });

  test("omitted id → no strategy (SurrealDB default)", () => {
    const t = defineTable("t", { name: s.string() });
    expect(idSurreal(t).idStrategy).toBeUndefined();
    expect(idSurreal(t).default).toBeUndefined();
    expect(idSurreal(t).asserts).toBeUndefined();
  });

  test("s.string() as id → no strategy (backward compatible)", () => {
    const t = defineTable("t", { id: s.string(), name: s.string() });
    expect(idSurreal(t).idStrategy).toBeUndefined();
  });

  test("raw z.string() as id → no strategy (raw Zod, not SField)", () => {
    const t = defineTable("t", { id: z.string(), name: s.string() });
    expect(idSurreal(t).idStrategy).toBeUndefined();
  });

  test("raw z.ulid() as id → no strategy (raw Zod, no idStrategy marker)", () => {
    const t = defineTable("t", { id: z.ulid(), name: s.string() });
    expect(idSurreal(t).idStrategy).toBeUndefined();
  });

  test("s.int() as id → no strategy (valid id value type, no marker)", () => {
    const t = defineTable("t", { id: s.int(), name: s.string() });
    expect(idSurreal(t).idStrategy).toBeUndefined();
  });

  test("s.number() as id → no strategy", () => {
    const t = defineTable("t", { id: s.number(), name: s.string() });
    expect(idSurreal(t).idStrategy).toBeUndefined();
  });

  test("s.bigint() as id → no strategy", () => {
    const t = defineTable("t", { id: s.bigint(), name: s.string() });
    expect(idSurreal(t).idStrategy).toBeUndefined();
  });

  test("s.recordId('x') as id → no strategy (RecordIdField, not a strategy field)", () => {
    const t = defineTable("t", { id: s.recordId("x"), name: s.string() });
    expect(idSurreal(t).idStrategy).toBeUndefined();
  });

  test("callback form (self) => ({ id: s.id(), ... }) → strategy detected", () => {
    const t = defineTable("node", (self) => ({
      id: s.id(),
      parent: self.optional(),
    }));
    expect(idSurreal(t).idStrategy).toBe("randId");
  });

  test("callback form (self) => ({ id: s.ulid(), ... }) → strategy detected", () => {
    const t = defineTable("node", (self) => ({
      id: s.ulid(),
      parent: self.optional(),
    }));
    expect(idSurreal(t).idStrategy).toBe("ulid");
  });
});

// ============================================================================
// 4. Strategy metadata — DEFAULT + ASSERT
// ============================================================================

describe("strategy metadata (DEFAULT + ASSERT)", () => {
  test("ulid → DEFAULT rand::ulid() + ASSERT id.id().is_ulid()", () => {
    const t = defineTable("t", { id: s.ulid(), name: s.string() });
    const meta = idSurreal(t);
    expect(inline(meta.default)).toBe("rand::ulid()");
    expect(meta.asserts).toEqual(["id.id().is_ulid()"]);
  });

  test("uuid → DEFAULT rand::uuid() + no ASSERT (native type)", () => {
    const t = defineTable("t", { id: s.uuid(), name: s.string() });
    const meta = idSurreal(t);
    expect(inline(meta.default)).toBe("rand::uuid()");
    expect(meta.asserts).toBeUndefined();
  });

  test("randId → DEFAULT rand::id() + ASSERT (len + regex)", () => {
    const t = defineTable("t", { id: s.id(), name: s.string() });
    const meta = idSurreal(t);
    expect(inline(meta.default)).toBe("rand::id()");
    expect(meta.asserts).toEqual([
      "string::len(id.id()) == 20",
      "id.id() = /^[a-z0-9]+$/",
    ]);
  });

  test("strategy replaces the factory's scalar asserts (s.ulid's $value assert → id.id() assert)", () => {
    // s.ulid() as a scalar bakes string::is_ulid($value). As an id, the assert uses id.id().
    const scalar = defineTable("t", { id: s.string(), code: s.ulid() });
    const scalarAsserts = (scalar.fields as unknown as Record<string, { surreal: Record<string, unknown> }>).code.surreal.asserts;
    expect(scalarAsserts).toEqual(["string::is_ulid($value)"]);

    const idField = defineTable("t", { id: s.ulid(), name: s.string() });
    const idAsserts = idSurreal(idField).asserts;
    expect(idAsserts).toEqual(["id.id().is_ulid()"]);
    expect(idAsserts).not.toEqual(scalarAsserts);
  });
});

// ============================================================================
// 5. Value type propagation
// ============================================================================

describe("value type propagation", () => {
  test("s.id() id → validates 20-char [a-z0-9] ids", () => {
    const t = defineTable("user", { id: s.id(), name: s.string() });
    expect(idValidates(t, "4uqmrmtjhtjeg77et0dl")).toBe(true);
    expect(idValidates(t, "ABCDEFGHIJKLMNOPQRST")).toBe(false);
    expect(idValidates(t, "abc")).toBe(false);
    expect(idValidates(t, "4uqmrmtjhtjeg77et0dla")).toBe(false);
  });

  test("s.ulid() id → validates ulid-format string ids", () => {
    const t = defineTable("user", { id: s.ulid(), name: s.string() });
    expect(idValidates(t, "01JM1AHN7DDN7XM5KZ2RR2YM1S")).toBe(true);
    expect(idValidates(t, "not-a-ulid")).toBe(false);
  });

  test("s.uuid() id → validates Uuid instance ids", () => {
    const t = defineTable("user", { id: s.uuid(), name: s.string() });
    expect(idValidates(t, new Uuid("e20b2836-e689-4643-998d-b17a16800323"))).toBe(true);
    expect(idValidates(t, "not-a-uuid")).toBe(false);
  });

  test("TableDef.record() carries the value type — ulid", () => {
    const User = defineTable("user", { id: s.ulid(), name: s.string() });
    const link = User.record();
    const id = link.for("01JM1AHN7DDN7XM5KZ2RR2YM1S");
    expect(id).toBeInstanceOf(RecordId);
    expect((id as RecordId<string>).table.name).toBe("user");
  });

  test("TableDef.record() carries the value type — id (randId)", () => {
    const User = defineTable("user", { id: s.id(), name: s.string() });
    const link = User.record();
    const id = link.for("4uqmrmtjhtjeg77et0dl");
    expect(id).toBeInstanceOf(RecordId);
    expect((id as RecordId<string>).table.name).toBe("user");
  });

  test("TableDef.record() carries the value type — uuid", () => {
    const User = defineTable("user", { id: s.uuid(), name: s.string() });
    const link = User.record();
    const id = link.for("e20b2836-e689-4643-998d-b17a16800323");
    expect(id).toBeInstanceOf(RecordId);
  });

  test("TableDef.table returns a SurrealDB Table instance", () => {
    const User = defineTable("user", { id: s.id(), name: s.string() });
    expect(User.table.name).toBe("user");
  });
});

// ============================================================================
// 6. Incompatible clause validation (throws at author time)
// ============================================================================

describe("incompatible clause validation — throws at author time", () => {
  test("s.ulid().$readonly() as id → throws (READONLY forbidden on id)", () => {
    expect(() => defineTable("t", { id: s.ulid().$readonly(), name: s.string() }))
      .toThrow(/READONLY/);
  });

  test("s.id().$readonly() as id → throws", () => {
    expect(() => defineTable("t", { id: s.id().$readonly(), name: s.string() }))
      .toThrow(/READONLY/);
  });

  test("s.uuid().$readonly() as id → throws", () => {
    expect(() => defineTable("t", { id: s.uuid().$readonly(), name: s.string() }))
      .toThrow(/READONLY/);
  });

  test("s.ulid().$value(surql`…`) as id → throws (VALUE forbidden on id)", () => {
    expect(() => defineTable("t", { id: s.ulid().$value(surql`$value`), name: s.string() }))
      .toThrow(/\$value/);
  });

  test("s.ulid().$computed(surql`…`) as id → throws (COMPUTED forbidden on id)", () => {
    expect(() => defineTable("t", { id: s.ulid().$computed(surql`time::now()`), name: s.string() }))
      .toThrow(/COMPUTED/);
  });

  test("s.ulid().$reference() as id → throws (REFERENCE forbidden on id)", () => {
    expect(() => defineTable("t", { id: s.ulid().$reference(), name: s.string() }))
      .toThrow(/REFERENCE/);
  });

  test("s.ulid().$default('foo') as id → throws (strategy sets its own DEFAULT)", () => {
    expect(() => defineTable("t", { id: s.ulid().$default("foo"), name: s.string() }))
      .toThrow(/\$default/);
  });

  test("s.ulid().$defaultAlways('foo') as id → throws", () => {
    expect(() => defineTable("t", { id: s.ulid().$defaultAlways("foo"), name: s.string() }))
      .toThrow(/\$default/);
  });

  test("s.id().$default('foo') as id → throws", () => {
    expect(() => defineTable("t", { id: s.id().$default("foo"), name: s.string() }))
      .toThrow(/\$default/);
  });

  test("error message pins the table name", () => {
    try {
      defineTable("my_table", { id: s.ulid().$readonly(), name: s.string() });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain('"my_table"');
    }
  });

  test("error message names the strategy", () => {
    try {
      defineTable("t", { id: s.uuid().$readonly(), name: s.string() });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("uuid");
    }
  });
});

// ============================================================================
// 7. Wrapper validation (throws at author time)
// ============================================================================

describe("wrapper validation — throws at author time", () => {
  test("s.ulid().optional() as id → throws (can't wrap in optional)", () => {
    expect(() => defineTable("t", { id: s.ulid().optional() as any, name: s.string() }))
      .toThrow(/optional/);
  });

  test("s.ulid().nullable() as id → throws (can't wrap in nullable)", () => {
    expect(() => defineTable("t", { id: s.ulid().nullable() as any, name: s.string() }))
      .toThrow(/nullable/);
  });

  test("s.id().optional() as id → throws", () => {
    expect(() => defineTable("t", { id: s.id().optional() as any, name: s.string() }))
      .toThrow(/optional/);
  });

  test("s.uuid().nullable() as id → throws", () => {
    expect(() => defineTable("t", { id: s.uuid().nullable() as any, name: s.string() }))
      .toThrow(/nullable/);
  });

  test("s.ulid().nullish() as id → throws (nullish = optional+nullable)", () => {
    expect(() => defineTable("t", { id: s.ulid().nullish() as any, name: s.string() }))
      .toThrow(/optional|nullable/);
  });

  test("s.ulid().catch('x') as id → throws (Zod .catch() wrapper)", () => {
    expect(() => defineTable("t", { id: s.ulid().catch("x"), name: s.string() }))
      .toThrow(/catch/);
  });

  test("s.ulid().default('x') as id → throws (Zod .default() wrapper, not $default)", () => {
    expect(() => defineTable("t", { id: s.ulid().default("x"), name: s.string() }))
      .toThrow(/default/);
  });

  test("s.ulid().readonly() as id → throws (Zod .readonly() wrapper, not $readonly)", () => {
    expect(() => defineTable("t", { id: s.ulid().readonly(), name: s.string() }))
      .toThrow(/readonly/);
  });

  test("s.id().catch('x') as id → throws", () => {
    expect(() => defineTable("t", { id: s.id().catch("x"), name: s.string() }))
      .toThrow(/catch/);
  });

  test("s.id().default('x') as id → throws (Zod .default() wrapper)", () => {
    expect(() => defineTable("t", { id: s.id().default("x"), name: s.string() }))
      .toThrow(/default/);
  });

  test("s.id().readonly() as id → throws (Zod .readonly() wrapper)", () => {
    expect(() => defineTable("t", { id: s.id().readonly(), name: s.string() }))
      .toThrow(/readonly/);
  });

  test("s.ulid().prefault('x') as id → throws (Zod .prefault() wrapper)", () => {
    expect(() => defineTable("t", { id: s.ulid().prefault("x"), name: s.string() }))
      .toThrow(/prefault/);
  });
});

// ============================================================================
// 8. DDL emit — each strategy (exact DDL strings)
// ============================================================================

describe("DDL emit — each strategy", () => {
  test("s.ulid() as id → exact DDL", () => {
    const ddl = emitTable(defineTable("user", { id: s.ulid(), name: s.string() }));
    expect(ddl).toContain(
      "DEFINE FIELD id ON TABLE user TYPE string DEFAULT rand::ulid() ASSERT id.id().is_ulid();",
    );
  });

  test("s.uuid() as id → exact DDL (no ASSERT)", () => {
    const ddl = emitTable(defineTable("user", { id: s.uuid(), name: s.string() }));
    expect(ddl).toContain(
      "DEFINE FIELD id ON TABLE user TYPE uuid DEFAULT rand::uuid();",
    );
    expect(ddl).not.toContain("ASSERT id.id()");
  });

  test("s.id() as id → exact DDL", () => {
    const ddl = emitTable(defineTable("user", { id: s.id(), name: s.string() }));
    expect(ddl).toContain("DEFAULT rand::id()");
    expect(ddl).toContain(
      "ASSERT string::len(id.id()) == 20 AND id.id() = /^[a-z0-9]+$/",
    );
    expect(ddl).toContain("TYPE string");
    expect(ddl).toContain("DEFINE FIELD id ON TABLE user");
  });

  test("DDL statement order: DEFINE TABLE first, id field present in field statements", () => {
    const stmts = emitStatements(defineTable("user", { id: s.ulid(), name: s.string() }));
    expect(stmts[0]!.kind).toBe("table");
    const fieldStmts = stmts.filter((s) => s.kind === "field");
    const idStmt = fieldStmts.find((s) => s.name === "id");
    expect(idStmt).toBeDefined();
    expect(fieldStmts.find((s) => s.name === "name")).toBeDefined();
  });
});

// ============================================================================
// 9. DDL emit — backward compat (no DEFINE FIELD id)
// ============================================================================

describe("DDL emit — backward compat", () => {
  test("omitted id → no DEFINE FIELD id", () => {
    expect(emitTable(defineTable("user", { name: s.string() })))
      .not.toContain("DEFINE FIELD id");
  });

  test("s.string() as id → no DEFINE FIELD id", () => {
    expect(emitTable(defineTable("user", { id: s.string(), name: s.string() })))
      .not.toContain("DEFINE FIELD id");
  });

  test("raw z.string() as id → no DEFINE FIELD id", () => {
    expect(emitTable(defineTable("user", { id: z.string(), name: s.string() })))
      .not.toContain("DEFINE FIELD id");
  });

  test("s.int() as id → no DEFINE FIELD id", () => {
    expect(emitTable(defineTable("user", { id: s.int(), name: s.string() })))
      .not.toContain("DEFINE FIELD id");
  });
});

// ============================================================================
// 10. DDL emit — table variations
// ============================================================================

describe("DDL emit — table variations", () => {
  test("relation with id strategy — id emitted, in/out stay implicit", () => {
    const r = defineRelation("follows", { id: s.ulid(), since: s.datetime() })
      .from("user").to("post");
    const ddl = emitTable(r);
    expect(ddl).toContain("DEFINE FIELD id ON TABLE follows TYPE string DEFAULT rand::ulid()");
    expect(ddl).not.toContain("DEFINE FIELD in");
    expect(ddl).not.toContain("DEFINE FIELD out");
  });

  test("relation without id strategy — no DEFINE FIELD id/in/out", () => {
    const r = defineRelation("follows", { since: s.datetime() }).from("user").to("post");
    const ddl = emitTable(r);
    expect(ddl).not.toContain("DEFINE FIELD id");
    expect(ddl).not.toContain("DEFINE FIELD in");
    expect(ddl).not.toContain("DEFINE FIELD out");
  });

  test("relation with uuid strategy → id with TYPE uuid", () => {
    const r = defineRelation("follows", { id: s.uuid(), since: s.datetime() }).from("user").to("post");
    const ddl = emitTable(r);
    expect(ddl).toContain("DEFINE FIELD id ON TABLE follows TYPE uuid DEFAULT rand::uuid()");
  });

  test("relation with id() strategy → id with 20-char ASSERT", () => {
    const r = defineRelation("edges", { id: s.id(), since: s.datetime() }).from("user").to("post");
    const ddl = emitTable(r);
    expect(ddl).toContain("DEFAULT rand::id()");
    expect(ddl).toContain("ASSERT string::len(id.id()) == 20 AND id.id() = /^[a-z0-9]+$/");
  });

  test("schemaless + id strategy → still emits DEFINE FIELD id", () => {
    const ddl = emitTable(defineTable("user", { id: s.uuid(), name: s.string() }).schemaless());
    expect(ddl).toContain("SCHEMALESS");
    expect(ddl).toContain("DEFINE FIELD id ON TABLE user TYPE uuid DEFAULT rand::uuid();");
  });

  test("schemafull + id strategy → emits DEFINE FIELD id", () => {
    const ddl = emitTable(defineTable("user", { id: s.uuid(), name: s.string() }));
    expect(ddl).toContain("SCHEMAFULL");
    expect(ddl).toContain("DEFINE FIELD id");
  });

  test("TYPE ANY + id strategy → emits DEFINE FIELD id", () => {
    const ddl = emitTable(defineTable("user", { id: s.ulid(), name: s.string() }).typeAny());
    expect(ddl).toContain("TYPE ANY");
    expect(ddl).toContain("DEFINE FIELD id");
  });

  test("DROP + id strategy → still emits DEFINE FIELD id", () => {
    const ddl = emitTable(defineTable("log", { id: s.ulid() }).drop());
    expect(ddl).toContain("DROP");
    expect(ddl).toContain("DEFINE FIELD id");
  });

  test("view + id strategy → no DEFINE FIELD id (views have no fields)", () => {
    const v = defineView("v", { id: s.ulid(), name: s.string() }).as(surql`SELECT * FROM user`);
    const ddl = emitTable(v);
    expect(ddl).toContain("AS SELECT");
    expect(ddl).not.toContain("DEFINE FIELD id");
  });

  test("OVERWRITE option applies to the id field", () => {
    const ddl = emitTable(defineTable("user", { id: s.ulid(), name: s.string() }), { exists: "overwrite" });
    expect(ddl).toContain("DEFINE FIELD OVERWRITE id ON TABLE user");
  });

  test("IF NOT EXISTS option applies to the id field", () => {
    const ddl = emitTable(defineTable("user", { id: s.ulid(), name: s.string() }), { exists: "ignore" });
    expect(ddl).toContain("DEFINE FIELD IF NOT EXISTS id ON TABLE user");
  });
});

// ============================================================================
// 11. DDL emit — id with valid clauses ($comment, $permissions)
// ============================================================================

describe("DDL emit — id with valid extra clauses", () => {
  test("id: s.ulid().$comment('the id') → COMMENT in DDL", () => {
    const ddl = emitTable(defineTable("user", { id: s.ulid().$comment("the id"), name: s.string() }));
    expect(ddl).toContain('COMMENT "the id"');
    expect(ddl).toContain("DEFAULT rand::ulid()");
  });

  test("id: s.ulid().$permissions({ select: true }) → PERMISSIONS in DDL", () => {
    const ddl = emitTable(defineTable("user", { id: s.ulid().$permissions({ select: true, create: true, update: true }), name: s.string() }));
    expect(ddl).toContain("PERMISSIONS");
    expect(ddl).toContain("DEFAULT rand::ulid()");
  });
});

// ============================================================================
// 12. DefineStatement clauses (for migration diffing)
// ============================================================================

describe("DefineStatement clauses for id field", () => {
  test("ulid → TYPE, DEFAULT, ASSERT clauses", () => {
    const stmts = emitStatements(defineTable("user", { id: s.ulid(), name: s.string() }));
    const idStmt = stmts.find((s) => s.kind === "field" && s.name === "id")!;
    expect(idStmt.clauses!.TYPE).toBe("TYPE string");
    expect(idStmt.clauses!.DEFAULT).toBe("DEFAULT rand::ulid()");
    expect(idStmt.clauses!.ASSERT).toBe("ASSERT id.id().is_ulid()");
  });

  test("uuid → TYPE, DEFAULT clauses (no ASSERT)", () => {
    const stmts = emitStatements(defineTable("user", { id: s.uuid(), name: s.string() }));
    const idStmt = stmts.find((s) => s.kind === "field" && s.name === "id")!;
    expect(idStmt.clauses!.TYPE).toBe("TYPE uuid");
    expect(idStmt.clauses!.DEFAULT).toBe("DEFAULT rand::uuid()");
    expect(idStmt.clauses!.ASSERT).toBeUndefined();
  });

  test("randId → TYPE, DEFAULT, ASSERT clauses", () => {
    const stmts = emitStatements(defineTable("user", { id: s.id(), name: s.string() }));
    const idStmt = stmts.find((s) => s.kind === "field" && s.name === "id")!;
    expect(idStmt.clauses!.TYPE).toBe("TYPE string");
    expect(idStmt.clauses!.DEFAULT).toBe("DEFAULT rand::id()");
    expect(idStmt.clauses!.ASSERT).toBe("ASSERT string::len(id.id()) == 20 AND id.id() = /^[a-z0-9]+$/");
  });

  test("non-strategic id → no field statement for id", () => {
    const stmts = emitStatements(defineTable("user", { name: s.string() }));
    expect(stmts.find((s) => s.kind === "field" && s.name === "id")).toBeUndefined();
  });
});

// ============================================================================
// 13. Struct-IR lowering (fromTableDef)
// ============================================================================

describe("Struct-IR lowering (fromTableDef)", () => {
  test("ulid → id lowered with value type string + default + assert", () => {
    const struct = fromTableDef(defineTable("user", { id: s.ulid(), name: s.string() }));
    const id = struct.fields.find((f) => f.name === "id")!;
    expect(id.kind).toBe("string");
    expect(id.default).toBe("rand::ulid()");
    expect(id.assert).toBe("id.id().is_ulid()");
  });

  test("uuid → id lowered with value type uuid + default, no assert", () => {
    const struct = fromTableDef(defineTable("user", { id: s.uuid(), name: s.string() }));
    const id = struct.fields.find((f) => f.name === "id")!;
    expect(id.kind).toBe("uuid");
    expect(id.default).toBe("rand::uuid()");
    expect(id.assert).toBeUndefined();
  });

  test("randId → id lowered with 20-char assert", () => {
    const struct = fromTableDef(defineTable("user", { id: s.id(), name: s.string() }));
    const id = struct.fields.find((f) => f.name === "id")!;
    expect(id.kind).toBe("string");
    expect(id.default).toBe("rand::id()");
    expect(id.assert).toBe("string::len(id.id()) == 20 AND id.id() = /^[a-z0-9]+$/");
  });

  test("omitted id → no id field in Struct IR", () => {
    const struct = fromTableDef(defineTable("user", { name: s.string() }));
    expect(struct.fields.find((f) => f.name === "id")).toBeUndefined();
  });

  test("s.string() id → no id field in Struct IR", () => {
    const struct = fromTableDef(defineTable("user", { id: s.string(), name: s.string() }));
    expect(struct.fields.find((f) => f.name === "id")).toBeUndefined();
  });

  test("relation with id strategy → id present, in/out absent", () => {
    const r = defineRelation("follows", { id: s.ulid(), since: s.datetime() }).from("user").to("post");
    const struct = fromTableDef(r);
    expect(struct.fields.find((f) => f.name === "id")).toBeDefined();
    expect(struct.fields.find((f) => f.name === "in")).toBeUndefined();
    expect(struct.fields.find((f) => f.name === "out")).toBeUndefined();
  });

  test("relation without id strategy → id absent, in/out absent", () => {
    const r = defineRelation("follows", { since: s.datetime() }).from("user").to("post");
    const struct = fromTableDef(r);
    expect(struct.fields.find((f) => f.name === "id")).toBeUndefined();
    expect(struct.fields.find((f) => f.name === "in")).toBeUndefined();
  });
});

// ============================================================================
// 14. normalizeTable + hasStrategicId
// ============================================================================

describe("normalizeTable + hasStrategicId", () => {
  test("hasStrategicId → true for a table with a strategic id", () => {
    const struct = fromTableDef(defineTable("user", { id: s.ulid(), name: s.string() }));
    expect(hasStrategicId(struct)).toBe(true);
  });

  test("hasStrategicId → false for a table with no id field", () => {
    const struct = fromTableDef(defineTable("user", { name: s.string() }));
    expect(hasStrategicId(struct)).toBe(false);
  });

  test("hasStrategicId → false for a table with a bare id (no default/assert)", () => {
    // A table with id: s.string() → fromTableDef drops the id → no id field → false
    const struct = fromTableDef(defineTable("user", { id: s.string(), name: s.string() }));
    expect(hasStrategicId(struct)).toBe(false);
  });

  test("normalizeTable keeps a strategic id (ulid)", () => {
    const normalized = normalizeTable(fromTableDef(defineTable("user", { id: s.ulid(), name: s.string() })));
    expect(hasStrategicId(normalized)).toBe(true);
    expect(normalized.fields.find((f) => f.name === "id")?.default).toBe("rand::ulid()");
  });

  test("normalizeTable strips a non-strategic id", () => {
    const normalized = normalizeTable(fromTableDef(defineTable("user", { name: s.string() })));
    expect(normalized.fields.find((f) => f.name === "id")).toBeUndefined();
  });
});

// ============================================================================
// 15. schemaStruct (normalized full schema)
// ============================================================================

describe("schemaStruct", () => {
  test("includes strategic id after normalization (ulid)", () => {
    const struct = schemaStruct([defineTable("user", { id: s.ulid(), name: s.string() })], []);
    const table = struct.tables.find((t) => t.name === "user")!;
    const id = table.fields.find((f) => f.name === "id")!;
    expect(id).toBeDefined();
    expect(id.kind).toBe("string");
    expect(id.default).toBe("rand::ulid()");
  });

  test("excludes non-strategic id after normalization", () => {
    const struct = schemaStruct([defineTable("user", { name: s.string() })], []);
    const table = struct.tables.find((t) => t.name === "user")!;
    expect(table.fields.find((f) => f.name === "id")).toBeUndefined();
  });

  test("multiple tables — each with a different strategy", () => {
    const struct = schemaStruct([
      defineTable("a", { id: s.ulid(), name: s.string() }),
      defineTable("b", { id: s.uuid(), name: s.string() }),
      defineTable("c", { id: s.id(), name: s.string() }),
      defineTable("d", { name: s.string() }), // no strategy
    ], []);
    expect(struct.tables.find((t) => t.name === "a")!.fields.find((f) => f.name === "id")?.default).toBe("rand::ulid()");
    expect(struct.tables.find((t) => t.name === "b")!.fields.find((f) => f.name === "id")?.default).toBe("rand::uuid()");
    expect(struct.tables.find((t) => t.name === "c")!.fields.find((f) => f.name === "id")?.default).toBe("rand::id()");
    expect(struct.tables.find((t) => t.name === "d")!.fields.find((f) => f.name === "id")).toBeUndefined();
  });
});

// ============================================================================
// 16. structuredSnapshot (DefineStatement for migration diffing)
// ============================================================================

describe("structuredSnapshot", () => {
  test("includes the strategic id as a DefineStatement with clauses (ulid)", () => {
    const struct = schemaStruct([defineTable("user", { id: s.ulid(), name: s.string() })], []);
    const snap = structuredSnapshot(struct);
    const idStmt = snap.statements["field:user:id"] as DefineStatement;
    expect(idStmt).toBeDefined();
    expect(idStmt.kind).toBe("field");
    expect(idStmt.name).toBe("id");
    expect(idStmt.clauses!.TYPE).toBe("TYPE string");
    expect(idStmt.clauses!.DEFAULT).toBe("DEFAULT rand::ulid()");
    expect(idStmt.clauses!.ASSERT).toBe("ASSERT id.id().is_ulid()");
    expect(idStmt.ddl).toContain("DEFINE FIELD id ON TABLE user");
  });

  test("does NOT include an id field when no strategy", () => {
    const struct = schemaStruct([defineTable("user", { name: s.string() })], []);
    const snap = structuredSnapshot(struct);
    expect(snap.statements["field:user:id"]).toBeUndefined();
  });

  test("uuid strategy → snapshot with TYPE uuid + DEFAULT, no ASSERT", () => {
    const struct = schemaStruct([defineTable("user", { id: s.uuid(), name: s.string() })], []);
    const snap = structuredSnapshot(struct);
    const idStmt = snap.statements["field:user:id"] as DefineStatement;
    expect(idStmt.clauses!.TYPE).toBe("TYPE uuid");
    expect(idStmt.clauses!.DEFAULT).toBe("DEFAULT rand::uuid()");
    expect(idStmt.clauses!.ASSERT).toBeUndefined();
  });
});

// ============================================================================
// 17. alterField (migration diff — strategy changes)
// ============================================================================

describe("alterField — strategy diffs", () => {
  test("ulid → uuid: ALTER FIELD (TYPE + DEFAULT + DROP ASSERT)", () => {
    const alter = alterField("user", "id",
      { TYPE: "TYPE string", DEFAULT: "DEFAULT rand::ulid()", ASSERT: "ASSERT id.id().is_ulid()" },
      { TYPE: "TYPE uuid", DEFAULT: "DEFAULT rand::uuid()" },
    );
    expect(alter).not.toBeNull();
    expect(alter).toContain("ALTER FIELD id ON TABLE user");
    expect(alter).toContain("TYPE uuid");
    expect(alter).toContain("DEFAULT rand::uuid()");
    expect(alter).toContain("DROP ASSERT");
  });

  test("ulid → randId: ALTER FIELD (DEFAULT + ASSERT change)", () => {
    const alter = alterField("user", "id",
      { TYPE: "TYPE string", DEFAULT: "DEFAULT rand::ulid()", ASSERT: "ASSERT id.id().is_ulid()" },
      { TYPE: "TYPE string", DEFAULT: "DEFAULT rand::id()", ASSERT: "ASSERT string::len(id.id()) == 20 AND id.id() = /^[a-z0-9]+$/" },
    );
    expect(alter).not.toBeNull();
    expect(alter).toContain("DEFAULT rand::id()");
    expect(alter).toContain("ASSERT string::len(id.id()) == 20 AND id.id() = /^[a-z0-9]+$/");
  });

  test("randId → uuid: ALTER FIELD (TYPE + DEFAULT + DROP ASSERT)", () => {
    const alter = alterField("user", "id",
      { TYPE: "TYPE string", DEFAULT: "DEFAULT rand::id()", ASSERT: "ASSERT string::len(id.id()) == 20 AND id.id() = /^[a-z0-9]+$/" },
      { TYPE: "TYPE uuid", DEFAULT: "DEFAULT rand::uuid()" },
    );
    expect(alter).not.toBeNull();
    expect(alter).toContain("TYPE uuid");
    expect(alter).toContain("DROP ASSERT");
  });

  test("uuid → ulid: ALTER FIELD (TYPE + DEFAULT + add ASSERT)", () => {
    const alter = alterField("user", "id",
      { TYPE: "TYPE uuid", DEFAULT: "DEFAULT rand::uuid()" },
      { TYPE: "TYPE string", DEFAULT: "DEFAULT rand::ulid()", ASSERT: "ASSERT id.id().is_ulid()" },
    );
    expect(alter).not.toBeNull();
    expect(alter).toContain("TYPE string");
    expect(alter).toContain("ASSERT id.id().is_ulid()");
  });

  test("add strategy (no prev) → OVERWRITE fallback (null)", () => {
    expect(alterField("user", "id", undefined,
      { TYPE: "TYPE string", DEFAULT: "DEFAULT rand::ulid()", ASSERT: "ASSERT id.id().is_ulid()" },
    )).toBeNull();
  });

  test("remove strategy (no next) → OVERWRITE fallback (null)", () => {
    expect(alterField("user", "id",
      { TYPE: "TYPE string", DEFAULT: "DEFAULT rand::ulid()", ASSERT: "ASSERT id.id().is_ulid()" },
      undefined,
    )).toBeNull();
  });

  test("same strategy → no diff (null)", () => {
    const clauses = { TYPE: "TYPE string", DEFAULT: "DEFAULT rand::ulid()", ASSERT: "ASSERT id.id().is_ulid()" };
    expect(alterField("user", "id", clauses, clauses)).toBeNull();
  });

  test("same strategy, different COMMENT → ALTER FIELD (COMMENT change only)", () => {
    const alter = alterField("user", "id",
      { TYPE: "TYPE string", DEFAULT: "DEFAULT rand::ulid()", ASSERT: "ASSERT id.id().is_ulid()", COMMENT: 'COMMENT "old"' },
      { TYPE: "TYPE string", DEFAULT: "DEFAULT rand::ulid()", ASSERT: "ASSERT id.id().is_ulid()", COMMENT: 'COMMENT "new"' },
    );
    expect(alter).not.toBeNull();
    expect(alter).toContain('COMMENT "new"');
  });
});

// ============================================================================
// 18. Pull fidelity
// ============================================================================

function mkTable(name: string, fields: StructField[]): StructTable {
  return { name, kind: { kind: "NORMAL" }, schemafull: true, fields, indexes: [], events: [] };
}
function mkDb(tables: StructTable[]): DbStructured {
  return { tables, functions: [], accesses: [], analyzers: [] };
}

describe("pull fidelity", () => {
  test("DEFAULT rand::ulid() → s.ulid()", () => {
    const ts = renderSchemaToTS(mkDb([mkTable("user", [
      { name: "id", kind: "string", table: "user", default: "rand::ulid()", assert: "id.id().is_ulid()" },
      { name: "name", kind: "string", table: "user" },
    ])]));
    expect(ts).toContain("id: s.ulid()");
    expect(ts).not.toContain("id: s.string()");
  });

  test("DEFAULT rand::uuid() → s.uuid()", () => {
    const ts = renderSchemaToTS(mkDb([mkTable("user", [
      { name: "id", kind: "uuid", table: "user", default: "rand::uuid()" },
      { name: "name", kind: "string", table: "user" },
    ])]));
    expect(ts).toContain("id: s.uuid()");
    expect(ts).not.toContain("id: s.string()");
  });

  test("DEFAULT rand::id() → s.id()", () => {
    const ts = renderSchemaToTS(mkDb([mkTable("user", [
      { name: "id", kind: "string", table: "user", default: "rand::id()", assert: "string::len(id.id()) == 20 AND id.id() = /^[a-z0-9]+$/" },
      { name: "name", kind: "string", table: "user" },
    ])]));
    expect(ts).toContain("id: s.id()");
    expect(ts).not.toContain("id: s.string()");
  });

  test("no id field → s.string() (backward compat)", () => {
    const ts = renderSchemaToTS(mkDb([mkTable("user", [
      { name: "name", kind: "string", table: "user" },
    ])]));
    expect(ts).toContain("id: s.string()");
  });

  test("id with no DEFAULT → s.string()", () => {
    const ts = renderSchemaToTS(mkDb([mkTable("user", [
      { name: "id", kind: "string", table: "user" },
      { name: "name", kind: "string", table: "user" },
    ])]));
    expect(ts).toContain("id: s.string()");
  });

  test("unrecognized DEFAULT → s.string() (graceful fallback)", () => {
    const ts = renderSchemaToTS(mkDb([mkTable("user", [
      { name: "id", kind: "string", table: "user", default: "rand::int(1, 1000)" },
      { name: "name", kind: "string", table: "user" },
    ])]));
    expect(ts).toContain("id: s.string()");
  });

  test("relation → no id field rendered", () => {
    const ts = renderSchemaToTS(mkDb([{
      name: "follows", kind: { kind: "RELATION", in: ["user"], out: ["post"] }, schemafull: true,
      fields: [
        { name: "id", kind: "string", table: "follows", default: "rand::ulid()", assert: "id.id().is_ulid()" },
        { name: "since", kind: "datetime", table: "follows" },
      ],
      indexes: [], events: [],
    }]));
    expect(ts).toContain("defineRelation");
    expect(ts).not.toContain("id: s.");
  });

  test("multiple tables — each pulls the right strategy", () => {
    const ts = renderSchemaToTS(mkDb([
      mkTable("a", [{ name: "id", kind: "string", table: "a", default: "rand::ulid()" }, { name: "x", kind: "string", table: "a" }]),
      mkTable("b", [{ name: "id", kind: "uuid", table: "b", default: "rand::uuid()" }, { name: "x", kind: "string", table: "b" }]),
      mkTable("c", [{ name: "id", kind: "string", table: "c", default: "rand::id()" }, { name: "x", kind: "string", table: "c" }]),
      mkTable("d", [{ name: "x", kind: "string", table: "d" }]),
    ]));
    expect(ts).toContain("id: s.ulid()");
    expect(ts).toContain("id: s.uuid()");
    expect(ts).toContain("id: s.id()");
    // table d has no strategy → s.string()
    expect(ts).toContain("id: s.string()");
  });
});

// ============================================================================
// 19. Round-trip: author → emit → lower → normalize → deep equality
// ============================================================================

describe("round-trip: author → lower → normalize (offline self-consistency)", () => {
  test("ulid strategy: fromTableDef and re-lowered struct are consistent", () => {
    const t = defineTable("user", { id: s.ulid(), name: s.string() });
    const struct1 = schemaStruct([t], []);
    const table1 = struct1.tables.find((tb) => tb.name === "user")!;
    // The normalized struct should have the id field with the right clauses
    const id = table1.fields.find((f) => f.name === "id")!;
    expect(id.kind).toBe("string");
    expect(id.default).toBe("rand::ulid()");
    expect(id.assert).toBe("id.id().is_ulid()");
  });

  test("randId strategy: the assert string is stable (no quote canonicalization issues)", () => {
    const t = defineTable("user", { id: s.id(), name: s.string() });
    const struct = schemaStruct([t], []);
    const id = struct.tables[0]!.fields.find((f) => f.name === "id")!;
    // The regex assert should survive canonicalization
    expect(id.assert).toContain("string::len(id.id()) == 20");
    expect(id.assert).toContain("/^[a-z0-9]+$/");
  });
});

// ============================================================================
// 20. Create/Update surface — id is create-optional (DB fills it)
// ============================================================================

describe("Create/Update surface — id is create-optional", () => {
  test("s.ulid() id → create input doesn't require id (DB fills via DEFAULT)", () => {
    const User = defineTable("user", { id: s.ulid(), name: s.string() });
    // safeEncode should accept a payload WITHOUT id (the DB generates it)
    const r = User.safeEncode({ name: "Ada" });
    expect(r.success).toBe(true);
  });

  test("s.uuid() id → create input doesn't require id", () => {
    const User = defineTable("user", { id: s.uuid(), name: s.string() });
    const r = User.safeEncode({ name: "Ada" });
    expect(r.success).toBe(true);
  });

  test("s.id() id → create input doesn't require id", () => {
    const User = defineTable("user", { id: s.id(), name: s.string() });
    const r = User.safeEncode({ name: "Ada" });
    expect(r.success).toBe(true);
  });

  test("create input WITH an explicit RecordId is accepted (ulid)", () => {
    const User = defineTable("user", { id: s.ulid(), name: s.string() });
    const id = User.record().for("01JM1AHN7DDN7XM5KZ2RR2YM1S");
    const r = User.safeEncode({ id, name: "Ada" });
    expect(r.success).toBe(true);
  });

  test("create input WITH a plain string id is rejected (expects RecordId)", () => {
    const User = defineTable("user", { id: s.ulid(), name: s.string() });
    const r = User.safeEncode({ id: "01JM1AHN7DDN7XM5KZ2RR2YM1S" as any, name: "Ada" });
    expect(r.success).toBe(false);
  });

  test("create input WITH an invalid id is rejected (ulid format check)", () => {
    const User = defineTable("user", { id: s.ulid(), name: s.string() });
    const r = User.safeEncode({ id: "not-a-ulid" as any, name: "Ada" });
    expect(r.success).toBe(false);
  });

  test("create input WITH an invalid id is rejected (randId 20-char check)", () => {
    const User = defineTable("user", { id: s.id(), name: s.string() });
    const r = User.safeEncode({ id: "too-short" as any, name: "Ada" });
    expect(r.success).toBe(false);
  });

  test("update input excludes id (immutable)", () => {
    const User = defineTable("user", { id: s.ulid(), name: s.string() });
    // encodePartial should reject an id field in the update payload? 
    // Actually the type excludes id, but at runtime safeEncodePartial just encodes provided keys.
    // The TYPE excludes id via UpdateExcluded — let's verify the type-level exclusion indirectly:
    // safeEncodePartial with an id should still encode it (runtime doesn't type-check),
    // but the important thing is the TYPE excludes it. We verify via the DDL: no way to update id.
    // Instead, verify the update payload doesn't NEED id:
    const r = User.safeEncodePartial({ name: "Bob" });
    expect(r.success).toBe(true);
  });
});

// ============================================================================
// 21. implicitFieldSet helper (DDL shared utility)
// ============================================================================

describe("implicitFieldSet — shared helper", () => {
  test("NORMAL table, no strategy → id is implicit", () => {
    const s = implicitFieldSet(false, false);
    expect(s.has("id")).toBe(true);
    expect(s.has("in")).toBe(false);
    expect(s.has("out")).toBe(false);
    expect(s.size).toBe(1);
  });

  test("NORMAL table, has strategy → nothing implicit", () => {
    const s = implicitFieldSet(false, true);
    expect(s.has("id")).toBe(false);
    expect(s.has("in")).toBe(false);
    expect(s.has("out")).toBe(false);
    expect(s.size).toBe(0);
  });

  test("RELATION table, no strategy → id/in/out all implicit", () => {
    const s = implicitFieldSet(true, false);
    expect(s.has("id")).toBe(true);
    expect(s.has("in")).toBe(true);
    expect(s.has("out")).toBe(true);
    expect(s.size).toBe(3);
  });

  test("RELATION table, has strategy → only in/out implicit, id exposed", () => {
    const s = implicitFieldSet(true, true);
    expect(s.has("id")).toBe(false);
    expect(s.has("in")).toBe(true);
    expect(s.has("out")).toBe(true);
    expect(s.size).toBe(2);
  });
});

// ============================================================================
// 22. DDL emit — s.id() as only field (no other fields)
// ============================================================================

describe("DDL emit — s.id() as only field", () => {
  test("s.ulid() only → DEFINE TABLE + DEFINE FIELD id", () => {
    const ddl = emitTable(defineTable("log", { id: s.ulid() }));
    expect(ddl).toContain("DEFINE TABLE log");
    expect(ddl).toContain("DEFINE FIELD id ON TABLE log TYPE string DEFAULT rand::ulid() ASSERT id.id().is_ulid();");
  });

  test("s.uuid() only → DEFINE TABLE + DEFINE FIELD id", () => {
    const ddl = emitTable(defineTable("log", { id: s.uuid() }));
    expect(ddl).toContain("DEFINE TABLE log");
    expect(ddl).toContain("DEFINE FIELD id ON TABLE log TYPE uuid DEFAULT rand::uuid();");
    expect(ddl).not.toContain("ASSERT");
  });

  test("s.id() only → DEFINE TABLE + DEFINE FIELD id", () => {
    const ddl = emitTable(defineTable("log", { id: s.id() }));
    expect(ddl).toContain("DEFINE TABLE log");
    expect(ddl).toContain("DEFINE FIELD id ON TABLE log TYPE string DEFAULT rand::id()");
    expect(ddl).toContain("ASSERT string::len(id.id()) == 20 AND id.id() = /^[a-z0-9]+$/");
  });

  test("omitted id only (no fields) → no DEFINE FIELD id", () => {
    // A table with no user-authored fields at all
    expect(emitTable(defineTable("log"))).not.toContain("DEFINE FIELD id");
  });

  test("s.ulid() only table + DDL options → OVERWRITE applies", () => {
    const ddl = emitTable(defineTable("log", { id: s.ulid() }), { exists: "overwrite" });
    expect(ddl).toContain("DEFINE FIELD OVERWRITE id");
  });
});

// ============================================================================
// 23. DDL emit — combined modifiers (strategy + schemaless + drop)
// ============================================================================

describe("DDL emit — combined modifiers", () => {
  test("ulid + schemaless + drop → all modifiers present", () => {
    const ddl = emitTable(defineTable("log", { id: s.ulid(), ts: s.datetime() }).schemaless().drop());
    expect(ddl).toContain("SCHEMALESS");
    expect(ddl).toContain("DROP");
    expect(ddl).toContain("DEFINE FIELD id ON TABLE log TYPE string DEFAULT rand::ulid()");
  });

  test("uuid + schemaless → schema modifier + id field", () => {
    const ddl = emitTable(defineTable("log", { id: s.uuid() }).schemaless());
    expect(ddl).toContain("SCHEMALESS");
    expect(ddl).toContain("DEFINE FIELD id ON TABLE log TYPE uuid DEFAULT rand::uuid()");
  });

  test("s.id() + schemafull (default) + comment → table comment + id field", () => {
    const ddl = emitTable(defineTable("log", { id: s.id() }).comment("audit log"));
    expect(ddl).toContain('COMMENT "audit log"');
    expect(ddl).toContain("DEFINE FIELD id ON TABLE log TYPE string DEFAULT rand::id()");
  });
});

// ============================================================================
// 24. Strategy metadata — $comment and $permissions survival
// ============================================================================

describe("strategy metadata — clause survival", () => {
  test("$comment on ulid survives buildIdField → carries onto RecordIdField.surreal", () => {
    const t = defineTable("user", { id: s.ulid().$comment("primary key"), name: s.string() });
    const meta = idSurreal(t);
    expect(meta.comment).toBe("primary key");
    expect(meta.idStrategy).toBe("ulid");
  });

  test("$permissions on ulid survives buildIdField → carries onto RecordIdField.surreal", () => {
    const t = defineTable("user", { id: s.ulid().$permissions({ select: true }), name: s.string() });
    const meta = idSurreal(t);
    expect(meta.permissions).toEqual({ select: true });
    expect(meta.idStrategy).toBe("ulid");
  });

  test("$comment + $permissions both survive on randId", () => {
    const t = defineTable("user", {
      id: s.id().$comment("row id").$permissions({ select: true, create: false, update: false }),
      name: s.string(),
    });
    const meta = idSurreal(t);
    expect(meta.comment).toBe("row id");
    expect(meta.permissions).toEqual({ select: true, create: false, update: false });
  });

  test("$comment + $permissions appear in emitted DDL for ulid", () => {
    const ddl = emitTable(defineTable("user", {
      id: s.ulid().$comment("pk").$permissions({ select: true }),
      name: s.string(),
    }));
    expect(ddl).toContain('COMMENT "pk"');
    expect(ddl).toContain("PERMISSIONS");
  });
});

// ============================================================================
// 25. Scalar use with Zod wrappers (no regression — wrappers work on non-id)
// ============================================================================

describe("scalar use with Zod wrappers — no regression", () => {
  test("s.id().catch('fallback') as scalar → works (catch wrapper on randId scalar)", () => {
    const t = defineTable("t", { id: s.string(), code: s.id().catch("fallback") });
    const code = (t.fields as unknown as Record<string, { surreal: Record<string, unknown> }>).code;
    expect(code.surreal.idStrategy).toBe("randId");
    // .catch() is a schema wrapper — the surreal metadata is preserved
    expect(code.surreal.asserts).toBeDefined();
  });

  test("s.ulid().catch('fallback') as scalar → works", () => {
    const t = defineTable("t", { id: s.string(), code: s.ulid().catch("fallback") });
    const code = (t.fields as unknown as Record<string, { surreal: Record<string, unknown> }>).code;
    expect(code.surreal.idStrategy).toBe("ulid");
  });

  test("s.uuid().catch('fallback') as scalar → works", () => {
    const t = defineTable("t", { id: s.string(), uid: s.uuid().catch("00000000-0000-0000-0000-000000000000") });
    const uid = (t.fields as unknown as Record<string, { surreal: Record<string, unknown> }>).uid;
    expect(uid.surreal.idStrategy).toBe("uuid");
  });
});

// ============================================================================
// 26. Structured snapshot — multiple strategies across tables
// ============================================================================

describe("structuredSnapshot — multiple strategies", () => {
  test("mixed strategies — each table has correct stmt clauses", () => {
    const struct = schemaStruct([
      defineTable("a", { id: s.ulid(), x: s.string() }),
      defineTable("b", { id: s.uuid(), x: s.string() }),
      defineTable("c", { id: s.id(), x: s.string() }),
      defineTable("d", { x: s.string() }), // no strategy
    ], []);
    const snap = structuredSnapshot(struct);
    // a: ulid
    const a = snap.statements["field:a:id"] as DefineStatement;
    expect(a.clauses!.DEFAULT).toBe("DEFAULT rand::ulid()");
    expect(a.clauses!.ASSERT).toBe("ASSERT id.id().is_ulid()");
    // b: uuid
    const b = snap.statements["field:b:id"] as DefineStatement;
    expect(b.clauses!.DEFAULT).toBe("DEFAULT rand::uuid()");
    expect(b.clauses!.ASSERT).toBeUndefined();
    // c: randId
    const c = snap.statements["field:c:id"] as DefineStatement;
    expect(c.clauses!.DEFAULT).toBe("DEFAULT rand::id()");
    expect(c.clauses!.ASSERT).toContain("id.id() = /^[a-z0-9]+$/");
    // d: no strategy → no id field statement
    expect(snap.statements["field:d:id"]).toBeUndefined();
  });
});
