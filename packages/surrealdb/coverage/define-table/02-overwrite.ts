import { defineTable } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "OVERWRITE — replace an existing table in place",
  note: "Emit flag (DefineOptions.exists = \"overwrite\"); the migration engine uses it to redefine a changed object.",
  ddl: `DEFINE TABLE OVERWRITE thing TYPE NORMAL SCHEMAFULL;`,
  def: defineTable("thing"),
  options: { exists: "overwrite" },
});
