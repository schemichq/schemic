import { defineAnalyzer } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "COMMENT — a stored description",
  note: "COMMENT is the last clause; a human-readable note kept with the analyzer.",
  ddl: `DEFINE ANALYZER documented COMMENT "the product search analyzer";`,
  def: defineAnalyzer("documented").comment("the product search analyzer"),
});
