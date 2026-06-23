import { defineTable } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "Base — DEFINE TABLE <name>",
  note: "defineTable defaults to TYPE NORMAL SCHEMAFULL; the bare form carries both.",
  ddl: `DEFINE TABLE thing TYPE NORMAL SCHEMAFULL;`,
  def: defineTable("thing"),
});
