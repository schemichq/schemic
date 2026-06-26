import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "PERMISSIONS NONE",
  note: "`.$permissions(false)` — emits `PERMISSIONS NONE`, locking the field to record users (the table still gates access).",
  ddl: `DEFINE TABLE doc TYPE NORMAL SCHEMAFULL;
DEFINE FIELD body ON TABLE doc TYPE string PERMISSIONS NONE;`,
  def: defineTable("doc", { body: s.string().$permissions(false) }).schemafull(),
});
