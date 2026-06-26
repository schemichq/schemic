import { defineTable, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "REFERENCE ON DELETE THEN @expression",
  note: "`.$reference({ onDelete: surql`…` })` — run a custom expression on delete of the referenced record (`$this`/`$reference` are bound).",
  ddl: `DEFINE TABLE comment TYPE NORMAL SCHEMAFULL;
DEFINE FIELD post ON TABLE comment TYPE record<post> REFERENCE ON DELETE THEN UPDATE $this SET deleted = true;`,
  def: defineTable("comment", {
    post: s
      .recordId("post")
      .$reference({ onDelete: surql`UPDATE $this SET deleted = true` }),
  }).schemafull(),
});
