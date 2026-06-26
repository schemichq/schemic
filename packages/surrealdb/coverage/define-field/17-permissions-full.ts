import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "PERMISSIONS FULL",
  note: "`.$permissions(true)` — emits `PERMISSIONS FULL`, granting record users unrestricted access to the field.",
  ddl: `DEFINE TABLE doc TYPE NORMAL SCHEMAFULL;
DEFINE FIELD body ON TABLE doc TYPE string PERMISSIONS FULL;`,
  def: defineTable("doc", { body: s.string().$permissions(true) }).schemafull(),
});
