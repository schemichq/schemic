import { defineTable, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "WHEN omitted — fires on every change",
  note: "`.event(name, { then })` with no `when` emits `DEFINE EVENT … THEN …` (no WHEN clause), so it runs on every write. SurrealDB stores the absent condition as the literal `true`.",
  ddl: `DEFINE TABLE user TYPE NORMAL SCHEMAFULL;
DEFINE FIELD email ON TABLE user TYPE string;
DEFINE EVENT touch ON TABLE user THEN UPDATE $value.id SET seen = time::now();`,
  def: defineTable("user", { email: s.string() })
    .schemafull()
    .event("touch", {
      then: surql`UPDATE $value.id SET seen = time::now()`,
    }),
});
