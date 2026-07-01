import { defineAccess } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "DURATION FOR GRANT | TOKEN | SESSION",
  note: "`.duration({ grant, token, session })` sets the grant/token/session lifetimes (FOR GRANT applies to BEARER grants).",
  ddl: `DEFINE ACCESS api ON DATABASE TYPE BEARER FOR USER DURATION FOR GRANT 30d, FOR TOKEN 15m, FOR SESSION 6h;`,
  def: defineAccess("api").onDatabase()
    .bearer({ for: "user" })
    .duration({ grant: "30d", token: "15m", session: "6h" }),
});
