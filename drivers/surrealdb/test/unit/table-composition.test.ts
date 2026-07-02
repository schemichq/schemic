// Ratified table-composition surface (cross-driver): P1 defineTable(s.object()) + public .fields,
// P2 TableDef.extend(), P3 derived .create/.update/.object. This file grows with each part.
import { describe, expect, test } from "bun:test";
import { surql } from "surrealdb";
import { z } from "zod";
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

describe("P2: TableDef.extend(shape | s.object())", () => {
  const base = { name: s.string(), email: s.email() };
  const audit = {
    createdAt: s.datetime().$readonly(),
    updatedAt: s.datetime().optional(),
  };

  test(".extend(rawShape) === defineTable with the merged map (id preserved)", () => {
    const composed = emitTable(defineTable("customer", base).extend(audit));
    const flat = emitTable(defineTable("customer", { ...base, ...audit }));
    expect(composed).toBe(flat);
    expect(composed).toContain("DEFINE FIELD createdAt ON TABLE customer");
    expect(composed).toContain("DEFINE FIELD email ON TABLE customer");
  });

  test(".extend(s.object(...)) unwraps native fields (same result)", () => {
    const viaObject = emitTable(defineTable("c", base).extend(s.object(audit)));
    const viaShape = emitTable(defineTable("c", base).extend(audit));
    expect(viaObject).toBe(viaShape);
  });

  test("added columns win on key conflict", () => {
    const t = emitTable(
      defineTable("c", { name: s.string() }).extend({
        name: s.string().$default("anon"),
      }),
    );
    expect(t).toContain("DEFAULT");
  });
});

describe("P3: derived .create / .update / .object schemas", () => {
  const customer = defineTable("customer", {
    name: s.string(),
    balance: s.number(),
    creditEnabled: s.boolean().$default(true), // DB-filled -> optional on create
    createdAt: s.datetime().$default(surql`time::now()`).$readonly(), // default -> create-optional; readonly -> not in update
  });

  test(".create makes $default/readonly/id optional but keeps the rest required", () => {
    // The exact bug in the hand-rolled version: creditEnabled must NOT be required on create.
    expect(customer.create.safeParse({ name: "a", balance: 0 }).success).toBe(
      true,
    );
    // still requires the genuinely-required fields:
    expect(customer.create.safeParse({ name: "a" }).success).toBe(false);
  });

  test(".update is a partial patch (all optional), excludes id + readonly", () => {
    expect(customer.update.safeParse({}).success).toBe(true);
    expect(customer.update.safeParse({ balance: 5 }).success).toBe(true);
    // id and readonly createdAt are not part of the update shape:
    expect("createdAt" in customer.update.shape).toBe(false);
    expect("id" in customer.update.shape).toBe(false);
  });

  test(".object is the full row schema (composable)", () => {
    expect("balance" in customer.object.shape).toBe(true);
  });

  test("the gulybyte customerInput pattern composes + validates correctly", () => {
    // Derived schemas are Zod objects, so `.extend` takes Zod schemas (z.*, not s.*).
    const customerInput = customer.create
      .or(customer.update.extend({ id: z.string() }))
      .refine((d) => !("balance" in d && (d.balance ?? 0) < 0), {
        message: "balance must be >= 0",
        path: ["balance"],
      });
    // create branch (no id, creditEnabled omitted — the fix):
    expect(customerInput.safeParse({ name: "a", balance: 0 }).success).toBe(
      true,
    );
    // update branch (id + a partial patch):
    expect(
      customerInput.safeParse({ id: "customer:1", balance: 5 }).success,
    ).toBe(true);
    // refine still bites:
    expect(customerInput.safeParse({ name: "a", balance: -1 }).success).toBe(
      false,
    );
  });
});
