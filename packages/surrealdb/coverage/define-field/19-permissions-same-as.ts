import { defineTable, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "PERMISSIONS — `same as` another op",
  note: '`"same as <op>"` reuses another op\'s resolved rule (authoring convenience). Here `update: "same as create"` resolves to create\'s WHERE and collapses into one `FOR create, update WHERE …`.',
  ddl: `DEFINE TABLE doc TYPE NORMAL SCHEMAFULL;
DEFINE FIELD body ON TABLE doc TYPE string PERMISSIONS FOR create, update WHERE $auth.id != NONE;`,
  def: defineTable("doc", {
    body: s.string().$permissions({
      create: surql`$auth.id != NONE`,
      update: "same as create",
    }),
  }).schemafull(),
});
