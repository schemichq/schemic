import { defineAccess } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "TYPE BEARER FOR RECORD",
  note: "`.bearer({ for: 'record' })` — bearer-token / API-key grants tied to a record.",
  ddl: `DEFINE ACCESS api ON DATABASE TYPE BEARER FOR RECORD;`,
  def: defineAccess("api").onDatabase().bearer({ for: "record" }),
});
