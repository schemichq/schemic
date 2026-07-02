import { defineAccess } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "TYPE JWT ALGORITHM @alg KEY @key",
  note: "`.jwt({ alg, key })` validates tokens with a symmetric/PEM key. NOTE: an inline literal key is a secret-in-code smell — Phase 2 moves keys to apply-time `env()`/`secret()` refs. Prefer `.jwt({ url })`.",
  ddl: `DEFINE ACCESS ext ON DATABASE TYPE JWT ALGORITHM HS512 KEY "shhh";`,
  def: defineAccess("ext").onDatabase().jwt({ alg: "HS512", key: "shhh" }),
});
