import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "IF NOT EXISTS — DEFINE FIELD IF NOT EXISTS …",
  note: 'Emit flag (DefineOptions.exists = "ignore") — the field line gets `DEFINE FIELD IF NOT EXISTS …` (a no-op when the field already exists).',
  ddl: `DEFINE TABLE IF NOT EXISTS product TYPE NORMAL SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS name ON TABLE product TYPE string;`,
  def: defineTable("product", { name: s.string() }).schemafull(),
  options: { exists: "ignore" },
});
