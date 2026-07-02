// Ratified table-composition surface (cross-driver): P1 defineTable(s.object()) + public .fields,
// P2 TableDef.extend(), P3 derived .create/.update/.object. This file grows with each part.
import { describe, expect, test } from "bun:test";
import { emitTable } from "../../src/ddl";
import { defineTable, s } from "../../src/index";

describe("P1: defineTable accepts s.object() + public .fields", () => {
  const fields = { name: s.string(), email: s.email() };

  test("defineTable(s.object(...)) emits identically to defineTable(raw fields)", () => {
    const fromObject = emitTable(defineTable("t", s.object(fields)));
    const fromRaw = emitTable(defineTable("t", fields));
    expect(fromObject).toBe(fromRaw);
    expect(fromObject).toContain("DEFINE FIELD email ON TABLE t");
  });

  test(".fields returns the NATIVE SField map (not the Zod-erased shape)", () => {
    const obj = s.object(fields);
    expect(Object.keys(obj.fields).sort()).toEqual(["email", "name"]);
    // It's the real SField (carries the SurrealDB DDL — the email assert), not an erased Zod schema.
    const t = emitTable(defineTable("u", obj.fields));
    expect(t).toContain("string::is_email($value)");
    // Distinct from `.shape` (Zod): the same keys, but Zod types (no DDL).
    expect(Object.keys(obj.shape).sort()).toEqual(["email", "name"]);
  });

  test(".fields stays in sync through composition, and composes into a table (pre-.extend)", () => {
    const withMeta = s
      .object(fields)
      .extend({ createdAt: s.datetime().$readonly() });
    const t = emitTable(defineTable("post", withMeta.fields));
    expect(t).toContain("DEFINE FIELD email ON TABLE post");
    expect(t).toContain("DEFINE FIELD createdAt ON TABLE post");
    expect(t).toContain("READONLY");
  });
});
