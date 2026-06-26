import { defineAccess } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "TYPE JWT URL @url (JWKS — secret-free)",
  note: "`.jwt({ url })` validates external tokens against a JWKS endpoint — no secret in code. The recommended verify-only form.",
  ddl: `DEFINE ACCESS ext ON DATABASE TYPE JWT URL "https://example.com/jwks.json";`,
  def: defineAccess("ext").onDatabase().jwt({ url: "https://example.com/jwks.json" }),
});
