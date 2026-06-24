import { defineTable, s } from "@schemic/surrealdb";
import { example } from "../_kit";

export default example(import.meta.url, {
  title: "REFERENCE — record link with ON DELETE",
  note: "Reference integrity: REJECT | CASCADE | UNSET | IGNORE | THEN <expr>.",
  ddl: `DEFINE TABLE ref TYPE NORMAL SCHEMAFULL;
DEFINE FIELD author ON TABLE ref TYPE record<user> REFERENCE ON DELETE CASCADE;`,
  def: defineTable("ref", {
    id: s.string(),
    author: s.recordId("user").$reference({ onDelete: "cascade" }),
  }),
});
