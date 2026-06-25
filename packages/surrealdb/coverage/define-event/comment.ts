import { defineTable, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "COMMENT @string",
  note: "`comment` stores a description on the event (emitted after THEN, per the grammar).",
  ddl: `DEFINE TABLE audit_cfg TYPE NORMAL SCHEMAFULL;
DEFINE FIELD entity ON TABLE audit_cfg TYPE string;
DEFINE EVENT on_change ON TABLE audit_cfg WHEN $before.entity != $after.entity THEN CREATE audit_log COMMENT "track entity changes";`,
  def: defineTable("audit_cfg", { entity: s.string() })
    .schemafull()
    .event("on_change", {
      when: surql`$before.entity != $after.entity`,
      then: surql`CREATE audit_log`,
      comment: "track entity changes",
    }),
});
