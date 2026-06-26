import { defineTable, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "DEFAULT ALWAYS @expression",
  note: "`.$defaultAlways(surql`…`)` — emits `DEFAULT ALWAYS`, so the expression is re-applied on every update (not just create) when the field is omitted.",
  ddl: `DEFINE TABLE event TYPE NORMAL SCHEMAFULL;
DEFINE FIELD updatedAt ON TABLE event TYPE datetime DEFAULT ALWAYS time::now();`,
  def: defineTable("event", {
    updatedAt: s.datetime().$defaultAlways(surql`time::now()`),
  }).schemafull(),
});
