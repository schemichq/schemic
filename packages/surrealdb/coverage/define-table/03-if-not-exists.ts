import { defineTable } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "IF NOT EXISTS — define only when absent",
  note: 'Emit flag (DefineOptions.exists = "ignore"); a no-op when the table already exists.',
  ddl: `DEFINE TABLE IF NOT EXISTS thing TYPE NORMAL SCHEMAFULL;`,
  def: defineTable("thing"),
  options: { exists: "ignore" },
});
