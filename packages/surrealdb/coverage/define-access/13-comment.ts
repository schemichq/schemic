import { defineAccess } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "COMMENT @string",
  note: "`.comment(…)` stores a description on the access.",
  ddl: `DEFINE ACCESS account ON DATABASE TYPE RECORD COMMENT "user accounts";`,
  def: defineAccess("account").onDatabase().comment("user accounts"),
});
