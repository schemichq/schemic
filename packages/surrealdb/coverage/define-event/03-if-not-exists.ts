import { defineTable, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "IF NOT EXISTS — DEFINE EVENT IF NOT EXISTS …",
  note: 'Emit flag (DefineOptions.exists = "ignore") — the event line gets `DEFINE EVENT IF NOT EXISTS …` (a no-op when the event already exists).',
  ddl: `DEFINE TABLE IF NOT EXISTS user TYPE NORMAL SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS email ON TABLE user TYPE string;
DEFINE EVENT IF NOT EXISTS email_changed ON TABLE user WHEN $before.email != $after.email THEN CREATE log SET user = $value.id;`,
  def: defineTable("user", { email: s.string() })
    .schemafull()
    .event("email_changed", {
      when: surql`$before.email != $after.email`,
      then: surql`CREATE log SET user = $value.id`,
    }),
  options: { exists: "ignore" },
});
