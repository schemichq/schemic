import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "REFERENCE ON DELETE REJECT",
  note: "A record-link field marked `.$reference({ onDelete: 'reject' })` — the DB tracks back-links and REJECTs deleting the referenced record while references remain.",
  ddl: `DEFINE TABLE comment TYPE NORMAL SCHEMAFULL;
DEFINE FIELD post ON TABLE comment TYPE record<post> REFERENCE ON DELETE REJECT;`,
  def: defineTable("comment", {
    post: s.recordId("post").$reference({ onDelete: "reject" }),
  }).schemafull(),
});
