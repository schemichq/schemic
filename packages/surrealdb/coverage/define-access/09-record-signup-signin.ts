import { defineAccess, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "RECORD SIGNUP + SIGNIN",
  note: "`.signup(surql`…`)` / `.signin(surql`…`)` are the RECORD auth bodies (braces added automatically), run on sign-up / sign-in.",
  ddl: `DEFINE ACCESS account ON DATABASE TYPE RECORD SIGNUP { CREATE user SET email = $email } SIGNIN { SELECT * FROM user WHERE email = $email };`,
  def: defineAccess("account").onDatabase()
    .signup(surql`CREATE user SET email = $email`)
    .signin(surql`SELECT * FROM user WHERE email = $email`),
});
