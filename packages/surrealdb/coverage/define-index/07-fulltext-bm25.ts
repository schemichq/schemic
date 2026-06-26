import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "FULLTEXT … BM25(@k1, @b)",
  note: "`.$fulltext({ analyzer, bm25: [k1, b] })` — tunes the BM25 ranking (k1 = term-frequency saturation, b = length normalization). Only the TUNED form emits; the default `BM25` is omitted (always applied).",
  ddl: `DEFINE TABLE doc TYPE NORMAL SCHEMAFULL;
DEFINE FIELD body ON TABLE doc TYPE string;
DEFINE INDEX doc_body_idx ON TABLE doc FIELDS body FULLTEXT ANALYZER simple BM25(1.2,0.75);`,
  def: defineTable("doc", {
    body: s.string().$fulltext({ analyzer: "simple", bm25: [1.2, 0.75] }),
  }).schemafull(),
});
