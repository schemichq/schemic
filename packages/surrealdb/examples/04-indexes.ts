/**
 * `DEFINE INDEX` — plain, UNIQUE, composite, COUNT, COMMENT, the vector indexes (HNSW / DISKANN), and
 * FULLTEXT search (with its `DEFINE ANALYZER`). Vector + fulltext defaults are stripped on emit so the
 * minimal authoring round-trips against SurrealDB's materialized form (see `test/parity/define-index`).
 */
import { type ExampleGroup, ex } from "./_kit";

const examples = [
  ex({
    title: "Plain and composite index",
    code: `defineTable("p", { id: s.string(), a: s.string(), b: s.string() }).index("ab", ["a", "b"])`,
    ddl: `DEFINE TABLE p TYPE NORMAL SCHEMAFULL;
DEFINE FIELD a ON TABLE p TYPE string;
DEFINE FIELD b ON TABLE p TYPE string;
DEFINE INDEX ab ON TABLE p FIELDS a, b;`,
  }),
  ex({
    title: "UNIQUE (composite/named, via table.index)",
    code: `defineTable("u", { id: s.string(), email: s.string() }).index("uq", ["email"], { unique: true })`,
    ddl: `DEFINE TABLE u TYPE NORMAL SCHEMAFULL;
DEFINE FIELD email ON TABLE u TYPE string;
DEFINE INDEX uq ON TABLE u FIELDS email UNIQUE;`,
  }),
  ex({
    title: "UNIQUE (single field, inline via field.$unique())",
    note: "Field DDL clauses are `$`-prefixed; the index name is auto-derived `<table>_<field>_idx`. (`.unique()` is a deprecated alias.)",
    code: `defineTable("u2", { id: s.string(), email: s.email().$unique() })`,
    ddl: `DEFINE TABLE u2 TYPE NORMAL SCHEMAFULL;
DEFINE FIELD email ON TABLE u2 TYPE string ASSERT string::is_email($value);
DEFINE INDEX u2_email_idx ON TABLE u2 FIELDS email UNIQUE;`,
  }),
  ex({
    title: "COUNT (materialized row-count, no FIELDS)",
    code: `defineTable("ct", { id: s.string() }).index("rows", [], { count: true })`,
    ddl: `DEFINE TABLE ct TYPE NORMAL SCHEMAFULL;
DEFINE INDEX rows ON TABLE ct COUNT;`,
  }),
  ex({
    title: "COMMENT",
    code: `defineTable("cm", { id: s.string(), email: s.string() }).index("uq", ["email"], { unique: true, comment: "email is unique" })`,
    ddl: `DEFINE TABLE cm TYPE NORMAL SCHEMAFULL;
DEFINE FIELD email ON TABLE cm TYPE string;
DEFINE INDEX uq ON TABLE cm FIELDS email UNIQUE COMMENT "email is unique";`,
  }),
  ex({
    title: "Vector HNSW — minimal (defaults stripped)",
    note: "Only DIMENSION authored; SurrealDB materializes DIST/TYPE/EFC/M/M0/LM — all stripped so it round-trips.",
    code: `defineTable("vh", { id: s.string(), emb: s.array(s.float()) }).index("vec", ["emb"], { hnsw: { dimension: 4 } })`,
    ddl: `DEFINE TABLE vh TYPE NORMAL SCHEMAFULL;
DEFINE FIELD emb ON TABLE vh TYPE array<float>;
DEFINE INDEX vec ON TABLE vh FIELDS emb HNSW DIMENSION 4;`,
  }),
  ex({
    title: "Vector HNSW — tuned",
    code: `defineTable("vh2", { id: s.string(), emb: s.array(s.float()) }).index("vec", ["emb"], { hnsw: { dimension: 8, dist: "cosine", type: "f64", efc: 200, m: 16 } })`,
    ddl: `DEFINE TABLE vh2 TYPE NORMAL SCHEMAFULL;
DEFINE FIELD emb ON TABLE vh2 TYPE array<float>;
DEFINE INDEX vec ON TABLE vh2 FIELDS emb HNSW DIMENSION 8 DIST COSINE TYPE F64 EFC 200 M 16;`,
  }),
  ex({
    title: "Vector DISKANN — minimal",
    code: `defineTable("vd", { id: s.string(), emb: s.array(s.float()) }).index("vec", ["emb"], { diskann: { dimension: 4 } })`,
    ddl: `DEFINE TABLE vd TYPE NORMAL SCHEMAFULL;
DEFINE FIELD emb ON TABLE vd TYPE array<float>;
DEFINE INDEX vec ON TABLE vd FIELDS emb DISKANN DIMENSION 4;`,
  }),
  ex({
    title: "FULLTEXT search index + DEFINE ANALYZER",
    note: "A FULLTEXT index deps on its analyzer (emitted first). Default BM25(1.2,0.75) is stripped.",
    code: `[
  defineAnalyzer("english", {
    tokenizers: ["blank"],
    filters: ["lowercase", "snowball(english)"],
  }),
  defineTable("doc", { id: s.string(), content: s.string() }).index("ft", ["content"], {
    fulltext: { analyzer: "english", highlights: true },
  }),
]`,
    ddl: `DEFINE ANALYZER english TOKENIZERS BLANK FILTERS LOWERCASE, SNOWBALL(ENGLISH);

DEFINE TABLE doc TYPE NORMAL SCHEMAFULL;
DEFINE FIELD content ON TABLE doc TYPE string;
DEFINE INDEX ft ON TABLE doc FIELDS content FULLTEXT ANALYZER english HIGHLIGHTS;`,
  }),
  ex({
    title: "FULLTEXT (single field, inline via field.$fulltext())",
    note: "`bm25: true` emits a bare `BM25` (SurrealDB's default k1=1.2,b=0.75); the index name auto-derives `<table>_<field>_idx`. Needs a matching `defineAnalyzer`.",
    code: `[
  defineAnalyzer("simple", { tokenizers: ["blank"], filters: ["lowercase"] }),
  defineTable("doc2", {
    id: s.string(),
    body: s.string().$fulltext("simple", { bm25: true, highlights: true }),
  }),
]`,
    ddl: `DEFINE ANALYZER simple TOKENIZERS BLANK FILTERS LOWERCASE;

DEFINE TABLE doc2 TYPE NORMAL SCHEMAFULL;
DEFINE FIELD body ON TABLE doc2 TYPE string;
DEFINE INDEX doc2_body_idx ON TABLE doc2 FIELDS body FULLTEXT ANALYZER simple BM25 HIGHLIGHTS;`,
  }),
  ex({
    title: "Vector HNSW (single field, inline via field.$hnsw())",
    code: `defineTable("vh3", { id: s.string(), emb: s.array(s.float()).$hnsw({ dimension: 4, dist: "cosine" }) })`,
    ddl: `DEFINE TABLE vh3 TYPE NORMAL SCHEMAFULL;
DEFINE FIELD emb ON TABLE vh3 TYPE array<float>;
DEFINE INDEX vh3_emb_idx ON TABLE vh3 FIELDS emb HNSW DIMENSION 4 DIST COSINE;`,
  }),
  ex({
    title: "Vector DISKANN (single field, inline via field.$diskann())",
    code: `defineTable("vd2", { id: s.string(), emb: s.array(s.float()).$diskann({ dimension: 4 }) })`,
    ddl: `DEFINE TABLE vd2 TYPE NORMAL SCHEMAFULL;
DEFINE FIELD emb ON TABLE vd2 TYPE array<float>;
DEFINE INDEX vd2_emb_idx ON TABLE vd2 FIELDS emb DISKANN DIMENSION 4;`,
  }),
];

export const group: ExampleGroup = {
  file: "04-indexes.ts",
  about:
    "DEFINE INDEX — plain/unique/composite/count/comment/HNSW/DISKANN/FULLTEXT (+ DEFINE ANALYZER)",
  examples,
};
