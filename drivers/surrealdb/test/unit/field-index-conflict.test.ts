import { describe, expect, test } from "bun:test";
import { emitTable } from "../../src/ddl";
import { defineTable, s } from "../../src/pure";

describe("field both .$unique() + spec (.$fulltext/hnsw/diskann)", () => {
  test(".$unique().$fulltext() emits TWO indexes — spec on _idx, UNIQUE on _uq", () => {
    const ddl = emitTable(
      defineTable("c", {
        id: s.string(),
        name: s.string().$unique().$fulltext("simple"),
      }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX c_name_idx ON TABLE c FIELDS name FULLTEXT ANALYZER simple;",
    );
    expect(ddl).toContain(
      "DEFINE INDEX c_name_uq ON TABLE c FIELDS name UNIQUE;",
    );
  });

  test(".$fulltext().$unique() (reverse order) emits same two indexes", () => {
    const ddl = emitTable(
      defineTable("c", {
        id: s.string(),
        name: s.string().$fulltext("simple").$unique(),
      }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX c_name_idx ON TABLE c FIELDS name FULLTEXT ANALYZER simple;",
    );
    expect(ddl).toContain(
      "DEFINE INDEX c_name_uq ON TABLE c FIELDS name UNIQUE;",
    );
  });

  test(".$unique().$fulltext() with bare .$fulltext() (no analyzer)", () => {
    const ddl = emitTable(
      defineTable("c", {
        id: s.string(),
        name: s.string().$unique().$fulltext(),
      }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX c_name_idx ON TABLE c FIELDS name FULLTEXT;",
    );
    expect(ddl).toContain(
      "DEFINE INDEX c_name_uq ON TABLE c FIELDS name UNIQUE;",
    );
  });

  test(".$unique().$fulltext() with tuned BM25 keeps the spec on _idx", () => {
    const ddl = emitTable(
      defineTable("d", {
        id: s.string(),
        body: s
          .string()
          .$unique()
          .$fulltext({ analyzer: "eng", bm25: [1.5, 0.75], highlights: true }),
      }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX d_body_idx ON TABLE d FIELDS body FULLTEXT ANALYZER eng BM25(1.5,0.75) HIGHLIGHTS;",
    );
    expect(ddl).toContain(
      "DEFINE INDEX d_body_uq ON TABLE d FIELDS body UNIQUE;",
    );
  });

  test(".$unique().$hnsw() emits both a HNSW _idx and a UNIQUE _uq", () => {
    const ddl = emitTable(
      defineTable("v", {
        id: s.string(),
        emb: s.array(s.number()).$unique().$hnsw({ dimension: 4 }),
      }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX v_emb_idx ON TABLE v FIELDS emb HNSW DIMENSION 4;",
    );
    expect(ddl).toContain(
      "DEFINE INDEX v_emb_uq ON TABLE v FIELDS emb UNIQUE;",
    );
  });

  test(".$hnsw().$unique() (reverse order) emits same two indexes", () => {
    const ddl = emitTable(
      defineTable("v", {
        id: s.string(),
        emb: s.array(s.number()).$hnsw({ dimension: 4 }).$unique(),
      }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX v_emb_idx ON TABLE v FIELDS emb HNSW DIMENSION 4;",
    );
    expect(ddl).toContain(
      "DEFINE INDEX v_emb_uq ON TABLE v FIELDS emb UNIQUE;",
    );
  });

  test(".$unique().$diskann() emits both a DISKANN _idx and a UNIQUE _uq", () => {
    const ddl = emitTable(
      defineTable("v", {
        id: s.string(),
        emb: s.array(s.number()).$unique().$diskann({ dimension: 4 }),
      }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX v_emb_idx ON TABLE v FIELDS emb DISKANN DIMENSION 4;",
    );
    expect(ddl).toContain(
      "DEFINE INDEX v_emb_uq ON TABLE v FIELDS emb UNIQUE;",
    );
  });

  test(".$index() + .$unique() + .$fulltext() — three-way chain", () => {
    const ddl = emitTable(
      defineTable("c", {
        id: s.string(),
        name: s.string().$index().$unique().$fulltext("simple"),
      }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX c_name_idx ON TABLE c FIELDS name FULLTEXT ANALYZER simple;",
    );
    expect(ddl).toContain(
      "DEFINE INDEX c_name_uq ON TABLE c FIELDS name UNIQUE;",
    );
  });

  test("each index is independently nameable: .$unique(name) names UNIQUE, spec name names the spec", () => {
    const ddl = emitTable(
      defineTable("c", {
        id: s.string(),
        name: s
          .string()
          .$unique("name_uq")
          .$fulltext({ analyzer: "simple", name: "name_search" }),
      }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX name_search ON TABLE c FIELDS name FULLTEXT ANALYZER simple;",
    );
    expect(ddl).toContain(
      "DEFINE INDEX name_uq ON TABLE c FIELDS name UNIQUE;",
    );
  });

  test("naming one side only — the other falls back to its auto name", () => {
    const ddl = emitTable(
      defineTable("c", {
        id: s.string(),
        name: s.string().$unique("name_uq").$fulltext("simple"), // only the UNIQUE is named
      }),
    );
    expect(ddl).toContain("DEFINE INDEX c_name_idx"); // spec auto
    expect(ddl).toContain("DEFINE INDEX name_uq"); // UNIQUE named
  });

  test("a lone .$unique(name) still names the single UNIQUE index (back-compat)", () => {
    const ddl = emitTable(
      defineTable("c", {
        id: s.string(),
        email: s.string().$unique("email_uq"),
      }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX email_uq ON TABLE c FIELDS email UNIQUE;",
    );
  });

  test("backtick-escaped field paths produce both indexes with sanitized names", () => {
    const ddl = emitTable(
      defineTable("t", {
        id: s.string(),
        "`some field`": s.string().$unique().$fulltext(),
      }),
    );
    expect(ddl).toContain("DEFINE INDEX");
    // Expect both indexes present — one with spec (FULLTEXT) and one UNIQUE.
    expect(ddl).toContain("FULLTEXT");
    expect(ddl).toContain("UNIQUE");
    // Names are sanitized and differ: spec ends in _idx, UNIQUE ends in _uq.
    const lines = ddl.split("\n").filter((l) => l.startsWith("DEFINE INDEX"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/_idx ON TABLE/);
    expect(lines[1]).toMatch(/_uq ON TABLE/);
  });

  test("nested field path produces both indexes", () => {
    const ddl = emitTable(
      defineTable("t", {
        id: s.string(),
        "addr.city": s.string().$unique().$fulltext(),
      }),
    );
    expect(ddl).toContain("FULLTEXT");
    expect(ddl).toContain("UNIQUE");
    const lines = ddl.split("\n").filter((l) => l.startsWith("DEFINE INDEX"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/_idx ON TABLE/);
    expect(lines[1]).toMatch(/_uq ON TABLE/);
  });
});

describe("no regression: lone indexes keep single-index behavior", () => {
  test("lone .$unique() emits single _idx UNIQUE", () => {
    const ddl = emitTable(
      defineTable("u", { id: s.string(), email: s.string().$unique() }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX u_email_idx ON TABLE u FIELDS email UNIQUE;",
    );
    expect(ddl).not.toContain("_uq");
    expect(ddl).not.toContain("FULLTEXT");
  });

  test("lone .$fulltext() emits single _idx FULLTEXT", () => {
    const ddl = emitTable(
      defineTable("d", { id: s.string(), body: s.string().$fulltext() }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX d_body_idx ON TABLE d FIELDS body FULLTEXT;",
    );
    expect(ddl).not.toContain("_uq");
    expect(ddl).not.toContain("UNIQUE");
  });

  test("lone .$hnsw() emits single _idx HNSW", () => {
    const ddl = emitTable(
      defineTable("v", {
        id: s.string(),
        emb: s.array(s.number()).$hnsw({ dimension: 4 }),
      }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX v_emb_idx ON TABLE v FIELDS emb HNSW DIMENSION 4;",
    );
    expect(ddl).not.toContain("_uq");
    expect(ddl).not.toContain("UNIQUE");
  });

  test("lone .$diskann() emits single _idx DISKANN", () => {
    const ddl = emitTable(
      defineTable("v", {
        id: s.string(),
        emb: s.array(s.number()).$diskann({ dimension: 4 }),
      }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX v_emb_idx ON TABLE v FIELDS emb DISKANN DIMENSION 4;",
    );
    expect(ddl).not.toContain("_uq");
    expect(ddl).not.toContain("UNIQUE");
  });

  test(".$index() alone emits single _idx without UNIQUE or spec", () => {
    const ddl = emitTable(
      defineTable("t", { id: s.string(), code: s.string().$index() }),
    );
    expect(ddl).toContain("DEFINE INDEX t_code_idx ON TABLE t FIELDS code;");
    expect(ddl).not.toContain("UNIQUE");
    expect(ddl).not.toContain("FULLTEXT");
  });
});

describe("table-level .index() with same field", () => {
  test("two named .index()es on same field emit both DDL statements", () => {
    const ddl = emitTable(
      defineTable("c", { id: s.string(), name: s.string() })
        .index("name_uq", ["name"], { unique: true })
        .index("name_ft", ["name"], { fulltext: { analyzer: "simple" } }),
    );
    expect(ddl).toContain(
      "DEFINE INDEX name_uq ON TABLE c FIELDS name UNIQUE;",
    );
    expect(ddl).toContain(
      "DEFINE INDEX name_ft ON TABLE c FIELDS name FULLTEXT ANALYZER simple;",
    );
  });
});
