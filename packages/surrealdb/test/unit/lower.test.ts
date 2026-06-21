import { describe, expect, test } from "bun:test";
import { surql } from "surrealdb";
import { fromStandalone, fromTableDef } from "../../src/cli/lower";
import { normalizeTable } from "../../src/cli/struct";
import {
  defineAccess,
  defineFunction,
  defineRelation,
  defineTable,
  s,
} from "../../src/pure";

// fromTableDef lowers an in-memory TableDef to the raw Struct IR; normalizeTable then folds it to
// the canonical form both lowerings converge on. We assert the NORMALIZED struct (the comparable
// shape), exercising the paths/clauses fromTableDef must populate. No live DB required.

const User = defineTable("user", { name: s.string() });
const Post = defineTable("post", { title: s.string() });

describe("fromTableDef", () => {
  test("plain table: primitives + optional + default + assert", () => {
    const t = defineTable("user", {
      email: s.string().$assert(surql`string::is_email($value)`),
      age: s.int().optional(),
      // optional + default: normalize strips `option<>` to `int` (a defaulted field is always
      // present, so INFO/the emitter store the bare type — both sides converge on `int`).
      count: s.int().optional().$default(0),
      active: s.boolean().$default(true),
    });
    expect(normalizeTable(fromTableDef(t))).toEqual({
      name: "user",
      kind: { kind: "NORMAL" },
      schemafull: true,
      fields: [
        { name: "active", kind: "bool", table: "user", default: "true" },
        { name: "age", kind: "option<int>", table: "user" },
        { name: "count", kind: "int", table: "user", default: "0" },
        {
          name: "email",
          kind: "string",
          table: "user",
          assert: "string::is_email($value)",
        },
      ],
      indexes: [],
      events: [],
    });
  });

  test("nested object field flattens to dotted paths (parent-before-child)", () => {
    const t = defineTable("account", {
      address: s.object({ city: s.string(), zip: s.string().optional() }),
    });
    expect(normalizeTable(fromTableDef(t)).fields).toEqual([
      { name: "address", kind: "object", table: "account" },
      { name: "address.city", kind: "string", table: "account" },
      { name: "address.zip", kind: "option<string>", table: "account" },
    ]);
  });

  test("array of primitive -> array<T> (no `.*`)", () => {
    const t = defineTable("post", { tags: s.array(s.string()) });
    expect(normalizeTable(fromTableDef(t)).fields).toEqual([
      { name: "tags", kind: "array<string>", table: "post" },
    ]);
  });

  test("array of object emits `.*` element folded into the parent, keeps `.*` subfield", () => {
    const t = defineTable("post", {
      authors: s.array(s.object({ handle: s.string() })),
    });
    expect(normalizeTable(fromTableDef(t)).fields).toEqual([
      { name: "authors", kind: "array<object>", table: "post" },
      { name: "authors.*.handle", kind: "string", table: "post" },
    ]);
  });

  test("record reference with ON DELETE", () => {
    const t = defineTable("comment", {
      author: s.recordId("user").reference({ onDelete: "cascade" }),
    });
    expect(normalizeTable(fromTableDef(t)).fields).toEqual([
      {
        name: "author",
        kind: "record<user>",
        table: "comment",
        reference: { on_delete: "CASCADE" },
      },
    ]);
  });

  test("relation: in/out land in kind, not as fields", () => {
    const wrote = defineRelation("wrote", { at: s.datetime() })
      .from(User)
      .to(Post);
    const out = normalizeTable(fromTableDef(wrote));
    expect(out.kind).toEqual({ kind: "RELATION", in: ["user"], out: ["post"] });
    expect(out.fields).toEqual([
      { name: "at", kind: "datetime", table: "wrote" },
    ]);
  });

  test("field with non-default permissions is kept", () => {
    const t = defineTable("secret", {
      data: s.string().$permissions({ select: false }),
    });
    expect(normalizeTable(fromTableDef(t)).fields).toEqual([
      {
        name: "data",
        kind: "string",
        table: "secret",
        permissions: { select: false },
      },
    ]);
  });

  test("single-field index + table comment/changefeed", () => {
    const t = defineTable("user", {
      email: s.string().unique(),
    })
      .comment("users")
      .changefeed("1h", { includeOriginal: true });
    const out = normalizeTable(fromTableDef(t));
    expect(out.indexes).toEqual([
      { name: "user_email_idx", cols: ["email"], index: "UNIQUE" },
    ]);
    expect(out.comment).toBe("users");
    expect(out.changefeed).toEqual({ expiry: "1h", original: true });
  });

  test("field .$fulltext()/.$hnsw() lower to a structured index carrying the spec", () => {
    const t = defineTable("doc", {
      id: s.string(),
      body: s.string().$fulltext("eng", { bm25: true, highlights: true }),
      emb: s.array(s.float()).$hnsw({ dimension: 4 }),
    });
    const out = normalizeTable(fromTableDef(t));
    expect(out.indexes).toEqual([
      {
        name: "doc_body_idx",
        cols: ["body"],
        index: "FULLTEXT ANALYZER eng BM25 HIGHLIGHTS",
      },
      { name: "doc_emb_idx", cols: ["emb"], index: "HNSW DIMENSION 4" },
    ]);
  });
});

describe("fromStandalone", () => {
  test("function -> StructFunction (args, brace-wrapped block, returns)", () => {
    const greet = defineFunction("greet", { name: s.string() })
      .returns(s.string())
      .body(surql`RETURN "hi " + $name`);
    expect(fromStandalone(greet)).toEqual({
      name: "greet",
      args: [["name", "string"]],
      block: '{ RETURN "hi " + $name }',
      returns: "string",
    });
  });

  test("access -> StructAccess (record kind + duration)", () => {
    const account = defineAccess("account")
      .record()
      .duration({ token: "1h", session: "12h" });
    expect(fromStandalone(account)).toEqual({
      name: "account",
      kind: { kind: "RECORD" },
      duration: { token: "1h", session: "12h" },
    });
  });
});
