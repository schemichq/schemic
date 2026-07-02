import { defineAccess } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "TYPE BEARER FOR USER",
  note: "`.bearer({ for: 'user' })` — bearer grants tied to a system user.",
  ddl: `DEFINE ACCESS api ON DATABASE TYPE BEARER FOR USER;`,
  def: defineAccess("api").onDatabase().bearer({ for: "user" }),
});
