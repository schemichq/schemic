import { defineAnalyzer } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "IF NOT EXISTS — define only when absent",
  note: 'Emit flag (DefineOptions.exists = "ignore"); a no-op when the analyzer already exists.',
  ddl: `DEFINE ANALYZER IF NOT EXISTS text;`,
  def: defineAnalyzer("text"),
  options: { exists: "ignore" },
});
