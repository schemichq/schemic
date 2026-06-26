import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "COMMENT @string",
  note: "`.index(name, fields, { comment })` — a stored description on the index.",
  ddl: `DEFINE TABLE product TYPE NORMAL SCHEMAFULL;
DEFINE FIELD sku ON TABLE product TYPE string;
DEFINE INDEX product_sku_idx ON TABLE product FIELDS sku COMMENT "sku lookup";`,
  def: defineTable("product", { sku: s.string() })
    .schemafull()
    .index("product_sku_idx", ["sku"], { comment: "sku lookup" }),
});
