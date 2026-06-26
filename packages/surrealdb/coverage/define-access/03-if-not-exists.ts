import { defineAccess } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "IF NOT EXISTS — DEFINE ACCESS IF NOT EXISTS …",
  note: 'Emit flag (DefineOptions.exists = "ignore").',
  ddl: `DEFINE ACCESS IF NOT EXISTS account ON DATABASE TYPE RECORD;`,
  def: defineAccess("account").onDatabase(),
  options: { exists: "ignore" },
});
