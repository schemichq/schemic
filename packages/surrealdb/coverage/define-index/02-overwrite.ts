import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "OVERWRITE — DEFINE INDEX OVERWRITE …",
  note: 'Emit flag (DefineOptions.exists = "overwrite") — the index line gets `DEFINE INDEX OVERWRITE …`.',
  ddl: `DEFINE TABLE OVERWRITE product TYPE NORMAL SCHEMAFULL;
DEFINE FIELD OVERWRITE name ON TABLE product TYPE string;
DEFINE INDEX OVERWRITE product_name_idx ON TABLE product FIELDS name;`,
  def: defineTable("product", { name: s.string() })
    .schemafull()
    .index("product_name_idx", ["name"]),
  options: { exists: "overwrite" },
});
