import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "REFERENCE ON DELETE IGNORE",
  note: "`.$reference({ onDelete: 'ignore' })` — deleting the referenced record is allowed; the dangling reference is left as-is.",
  ddl: `DEFINE TABLE comment TYPE NORMAL SCHEMAFULL;
DEFINE FIELD post ON TABLE comment TYPE record<post> REFERENCE ON DELETE IGNORE;`,
  def: defineTable("comment", {
    post: s.recordId("post").$reference({ onDelete: "ignore" }),
  }).schemafull(),
});
