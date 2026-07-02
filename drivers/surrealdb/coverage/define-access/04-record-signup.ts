import { defineAccess, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "RECORD SIGNUP",
  note: "`.signup(surql`…`)` — the RECORD sign-up auth body (braces added automatically), run when a new user signs up.",
  ddl: `DEFINE ACCESS account ON DATABASE TYPE RECORD SIGNUP { CREATE user SET email = $email };`,
  def: defineAccess("account").onDatabase().record().signup(surql`CREATE user SET email = $email`),
});
