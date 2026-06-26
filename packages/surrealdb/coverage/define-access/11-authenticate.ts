import { defineAccess, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "AUTHENTICATE @expression",
  note: "`.authenticate(surql`…`)` runs on every authenticated request (e.g. to re-validate or enrich `$auth`).",
  ddl: `DEFINE ACCESS account ON DATABASE TYPE RECORD AUTHENTICATE { RETURN $auth };`,
  def: defineAccess("account").onDatabase().authenticate(surql`RETURN $auth`),
});
