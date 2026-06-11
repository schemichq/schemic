import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  BoundExcluded,
  BoundIncluded,
  RecordId,
  RecordIdRange,
} from "surrealdb";
import { sz, defineTable } from "../../src/pure";

describe("recordId schema validation", () => {
  test("single table restriction", () => {
    const f = sz.recordId("user");
    expect(f.schema.safeParse(new RecordId("user", "x")).success).toBe(true);
    expect(f.schema.safeParse(new RecordId("post", "x")).success).toBe(false);
    expect(f.schema.safeParse("user:x").success).toBe(false); // must be a RecordId instance
  });

  test("multi table restriction", () => {
    const f = sz.recordId(["user", "admin"]);
    expect(f.schema.safeParse(new RecordId("user", "x")).success).toBe(true);
    expect(f.schema.safeParse(new RecordId("admin", "x")).success).toBe(true);
    expect(f.schema.safeParse(new RecordId("post", "x")).success).toBe(false);
  });

  test(".type narrows the id value type", () => {
    const f = sz.recordId("user").type(z.number());
    expect(f.schema.safeParse(new RecordId("user", 5)).success).toBe(true);
    expect(f.schema.safeParse(new RecordId("user", "x")).success).toBe(false);
  });
});

describe(".for", () => {
  test("single-table: for(id)", () => {
    const r = sz.recordId("user").for("alice");
    expect(r).toBeInstanceOf(RecordId);
    expect(r.table.name).toBe("user");
    expect(r.id).toBe("alice");
  });

  test("multi-table: for(table, id)", () => {
    const r = sz.recordId(["user", "admin"]).for("admin", "root");
    expect(r.table.name).toBe("admin");
    expect(r.id).toBe("root");
  });
});

describe(".range", () => {
  const f = sz.recordId("user");

  test("default: inclusive start, exclusive end", () => {
    const r = f.range("a", "z");
    expect(r).toBeInstanceOf(RecordIdRange);
    expect(r.begin).toBeInstanceOf(BoundIncluded);
    expect(r.end).toBeInstanceOf(BoundExcluded);
    expect((r.begin as BoundIncluded<unknown>).value).toBe("a");
    expect((r.end as BoundExcluded<unknown>).value).toBe("z");
  });

  test("open bounds when an end is omitted", () => {
    expect(f.range(undefined, "z").begin).toBeUndefined();
    expect(f.range("a", undefined).end).toBeUndefined();
  });

  test("explicit Bound overrides inclusivity", () => {
    const r = f.range(new BoundExcluded("a"), new BoundIncluded("z"));
    expect(r.begin).toBeInstanceOf(BoundExcluded);
    expect(r.end).toBeInstanceOf(BoundIncluded);
  });
});

describe("TableDef.record()", () => {
  test("derives a record<name> link carrying the id value type", () => {
    const User = defineTable("user", { id: z.string(), name: sz.string() });
    const link = User.record();
    expect(link.tables).toEqual(["user"]);
    expect(link.for("x").table.name).toBe("user");
    // id value type carried over (string id rejects numeric)
    expect(link.schema.safeParse(new RecordId("user", "x")).success).toBe(true);
    expect(link.schema.safeParse(new RecordId("user", 5)).success).toBe(false);
  });

  test("defaults to RecordIdValue when no id field is declared", () => {
    const Post = defineTable("post", { title: sz.string() });
    const link = Post.record();
    expect(link.tables).toEqual(["post"]);
    expect(link.schema.safeParse(new RecordId("post", 5)).success).toBe(true);
  });
});
