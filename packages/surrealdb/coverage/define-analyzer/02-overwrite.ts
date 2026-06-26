import { defineAnalyzer } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "OVERWRITE — replace an existing analyzer in place",
  note: 'Emit flag (DefineOptions.exists = "overwrite"); the migration engine uses it to redefine a changed analyzer.',
  ddl: `DEFINE ANALYZER OVERWRITE text;`,
  def: defineAnalyzer("text"),
  options: { exists: "overwrite" },
});
