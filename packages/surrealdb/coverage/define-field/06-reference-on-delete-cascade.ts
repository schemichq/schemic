import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "REFERENCE ON DELETE CASCADE",
  note: "`.$reference({ onDelete: 'cascade' })` — deleting the referenced record CASCADEs, deleting the referencing record too.",
  ddl: `DEFINE TABLE comment TYPE NORMAL SCHEMAFULL;
DEFINE FIELD post ON TABLE comment TYPE record<post> REFERENCE ON DELETE CASCADE;`,
  def: defineTable("comment", {
    post: s.recordId("post").$reference({ onDelete: "cascade" }),
  }).schemafull(),
});
