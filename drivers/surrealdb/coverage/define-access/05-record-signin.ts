import { defineAccess, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "RECORD SIGNIN",
  note: "`.signin(surql`…`)` — the RECORD sign-in auth body (braces added automatically), run on sign-in.",
  ddl: `DEFINE ACCESS account ON DATABASE TYPE RECORD SIGNIN { SELECT * FROM user WHERE email = $email };`,
  def: defineAccess("account").onDatabase().record().signin(surql`SELECT * FROM user WHERE email = $email`),
});
