import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "COMMENT @string",
  note: "`.$comment(…)` — a stored field description (distinct from `.meta()`, which is app-side JSON-schema docs).",
  ddl: `DEFINE TABLE doc TYPE NORMAL SCHEMAFULL;
DEFINE FIELD body ON TABLE doc TYPE string COMMENT "the post body";`,
  def: defineTable("doc", {
    body: s.string().$comment("the post body"),
  }).schemafull(),
});
