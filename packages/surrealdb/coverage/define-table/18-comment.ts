import { defineTable } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "COMMENT — attach a description",
  note: "`.comment(string)` — a human description stored on the table; round-trips through INFO.",
  ddl: `DEFINE TABLE thing TYPE NORMAL SCHEMAFULL COMMENT "a thing";`,
  def: defineTable("thing").comment("a thing"),
});
