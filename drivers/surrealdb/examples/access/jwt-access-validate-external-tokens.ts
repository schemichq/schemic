import { defineAccess } from "@schemic/surrealdb";
import { example } from "../_kit";

export default example(import.meta.url, {
  title: "JWT access (validate external tokens)",
  note: "Structure (alg + key/url) applies + introspects, but the signing KEY is redacted on pull.",
  ddl: `DEFINE ACCESS external ON DATABASE TYPE JWT ALGORITHM HS512 KEY "secret";`,
  def: defineAccess("external")
    .onDatabase()
    .jwt({ alg: "HS512", key: "secret" }),
});
