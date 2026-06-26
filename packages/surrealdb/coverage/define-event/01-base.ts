import { defineTable, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "Base — DEFINE EVENT <name> ON TABLE <table> WHEN <cond> THEN <action>",
  note: "`.event(name, { when, then })` — a row-change trigger; `WHEN` gates it and `THEN` runs the action. The event context (`$before`/`$after`/`$value`/`$event`) is bound by SurrealDB.",
  ddl: `DEFINE TABLE user TYPE NORMAL SCHEMAFULL;
DEFINE FIELD email ON TABLE user TYPE string;
DEFINE EVENT email_changed ON TABLE user WHEN $before.email != $after.email THEN CREATE log SET user = $value.id;`,
  def: defineTable("user", { email: s.string() })
    .schemafull()
    .event("email_changed", {
      when: surql`$before.email != $after.email`,
      then: surql`CREATE log SET user = $value.id`,
    }),
});
