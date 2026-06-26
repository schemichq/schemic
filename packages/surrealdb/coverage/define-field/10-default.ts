import { defineTable, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "DEFAULT @expression",
  note: "`.$default(surql`…`)` — the DB fills the field with the expression's value on create when it's omitted.",
  ddl: `DEFINE TABLE event TYPE NORMAL SCHEMAFULL;
DEFINE FIELD createdAt ON TABLE event TYPE datetime DEFAULT time::now();`,
  def: defineTable("event", {
    createdAt: s.datetime().$default(surql`time::now()`),
  }).schemafull(),
});
