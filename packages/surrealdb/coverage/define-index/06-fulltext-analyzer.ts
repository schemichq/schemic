import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "FULLTEXT ANALYZER @analyzer",
  note: "`.$fulltext(analyzer)` — a full-text search index over the field, tokenized by a named `defineAnalyzer`. Default BM25 scoring is applied by SurrealDB and omitted from the DDL.",
  ddl: `DEFINE TABLE doc TYPE NORMAL SCHEMAFULL;
DEFINE FIELD body ON TABLE doc TYPE string;
DEFINE INDEX doc_body_idx ON TABLE doc FIELDS body FULLTEXT ANALYZER simple;`,
  def: defineTable("doc", {
    body: s.string().$fulltext("simple"),
  }).schemafull(),
});
