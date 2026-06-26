import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "OVERWRITE — DEFINE FIELD OVERWRITE …",
  note: 'Emit flag (DefineOptions.exists = "overwrite") — applies to the whole emit, so the field line gets `DEFINE FIELD OVERWRITE …`.',
  ddl: `DEFINE TABLE OVERWRITE product TYPE NORMAL SCHEMAFULL;
DEFINE FIELD OVERWRITE name ON TABLE product TYPE string;`,
  def: defineTable("product", { name: s.string() }).schemafull(),
  options: { exists: "overwrite" },
});
