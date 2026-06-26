import { defineAccess, surql } from "@schemic/surrealdb";
import { example } from "../_kit";

export default example(import.meta.url, {
  title: "RECORD access (SIGNUP / SIGNIN / DURATION)",
  ddl: `DEFINE ACCESS user ON DATABASE TYPE RECORD SIGNUP { CREATE user SET email = $email, pass = crypto::argon2::generate($pass) } SIGNIN { SELECT * FROM user WHERE email = $email AND crypto::argon2::compare(pass, $pass) } DURATION FOR TOKEN 1h, FOR SESSION 12h;`,
  def: defineAccess("user")
    .onDatabase()
    .record()
    .signup(
      surql`CREATE user SET email = $email, pass = crypto::argon2::generate($pass)`,
    )
    .signin(
      surql`SELECT * FROM user WHERE email = $email AND crypto::argon2::compare(pass, $pass)`,
    )
    .duration({ token: "1h", session: "12h" }),
});
