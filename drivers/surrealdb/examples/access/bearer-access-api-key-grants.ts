import { defineAccess } from "@schemic/surrealdb";
import { example } from "../_kit";

export default example(import.meta.url, {
  title: "BEARER access (API-key grants)",
  note: "Subject + duration round-trip; the grant secret is redacted on introspect.",
  ddl: `DEFINE ACCESS apikey ON DATABASE TYPE BEARER FOR USER DURATION FOR SESSION 30d;`,
  def: defineAccess("apikey")
    .onDatabase()
    .bearer({ for: "user" })
    .duration({ session: "30d" }),
});
