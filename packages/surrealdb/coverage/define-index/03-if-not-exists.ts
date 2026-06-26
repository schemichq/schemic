import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "IF NOT EXISTS — DEFINE INDEX IF NOT EXISTS …",
  note: 'Emit flag (DefineOptions.exists = "ignore") — the index line gets `DEFINE INDEX IF NOT EXISTS …` (a no-op when the index already exists).',
  ddl: `DEFINE TABLE IF NOT EXISTS product TYPE NORMAL SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS name ON TABLE product TYPE string;
DEFINE INDEX IF NOT EXISTS product_name_idx ON TABLE product FIELDS name;`,
  def: defineTable("product", { name: s.string() })
    .schemafull()
    .index("product_name_idx", ["name"]),
  options: { exists: "ignore" },
});
