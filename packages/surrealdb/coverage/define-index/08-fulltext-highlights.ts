import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "FULLTEXT … HIGHLIGHTS",
  note: "`.$fulltext({ analyzer, highlights: true })` — emits `HIGHLIGHTS`, enabling `search::highlight()` to mark matched terms in results.",
  ddl: `DEFINE TABLE doc TYPE NORMAL SCHEMAFULL;
DEFINE FIELD body ON TABLE doc TYPE string;
DEFINE INDEX doc_body_idx ON TABLE doc FIELDS body FULLTEXT ANALYZER simple HIGHLIGHTS;`,
  def: defineTable("doc", {
    body: s.string().$fulltext({ analyzer: "simple", highlights: true }),
  }).schemafull(),
});
