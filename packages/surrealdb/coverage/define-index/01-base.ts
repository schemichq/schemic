import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "Base — DEFINE INDEX <name> ON TABLE <table> FIELDS <fields>",
  note: "A table-level index via `.index(name, [fields])`; emitTable emits the DEFINE INDEX after the table + fields. The plain form (no special clause) is a standard secondary index.",
  ddl: `DEFINE TABLE product TYPE NORMAL SCHEMAFULL;
DEFINE FIELD name ON TABLE product TYPE string;
DEFINE INDEX product_name_idx ON TABLE product FIELDS name;`,
  def: defineTable("product", { name: s.string() })
    .schemafull()
    .index("product_name_idx", ["name"]),
});
