import { defineAccess } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "OVERWRITE — DEFINE ACCESS OVERWRITE …",
  note: 'Emit flag (DefineOptions.exists = "overwrite").',
  ddl: `DEFINE ACCESS OVERWRITE account ON DATABASE TYPE RECORD;`,
  def: defineAccess("account").onDatabase().record(),
  options: { exists: "overwrite" },
});
