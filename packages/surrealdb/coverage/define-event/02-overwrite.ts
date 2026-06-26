import { defineTable, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "OVERWRITE — DEFINE EVENT OVERWRITE …",
  note: 'Emit flag (DefineOptions.exists = "overwrite") — the event line gets `DEFINE EVENT OVERWRITE …`.',
  ddl: `DEFINE TABLE OVERWRITE user TYPE NORMAL SCHEMAFULL;
DEFINE FIELD OVERWRITE email ON TABLE user TYPE string;
DEFINE EVENT OVERWRITE email_changed ON TABLE user WHEN $before.email != $after.email THEN CREATE log SET user = $value.id;`,
  def: defineTable("user", { email: s.string() })
    .schemafull()
    .event("email_changed", {
      when: surql`$before.email != $after.email`,
      then: surql`CREATE log SET user = $value.id`,
    }),
  options: { exists: "overwrite" },
});
