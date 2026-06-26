import { defineAccess, surql } from "@schemic/surrealdb";
import { example } from "../_kit";

export default example(import.meta.url, {
  title: "RECORD access with AUTHENTICATE",
  ddl: `DEFINE ACCESS api ON DATABASE TYPE RECORD AUTHENTICATE { RETURN $auth } DURATION FOR SESSION 1d;`,
  def: defineAccess("api")
    .onDatabase()
    .record()
    .authenticate(surql`RETURN $auth`)
    .duration({ session: "1d" }),
});
