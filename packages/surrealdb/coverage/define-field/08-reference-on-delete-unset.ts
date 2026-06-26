import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "REFERENCE ON DELETE UNSET",
  note: "`.$reference({ onDelete: 'unset' })` — deleting the referenced record UNSETs (clears) the referencing field.",
  ddl: `DEFINE TABLE comment TYPE NORMAL SCHEMAFULL;
DEFINE FIELD post ON TABLE comment TYPE record<post> REFERENCE ON DELETE UNSET;`,
  def: defineTable("comment", {
    post: s.recordId("post").$reference({ onDelete: "unset" }),
  }).schemafull(),
});
