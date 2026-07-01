import { defineAccess } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "ON NAMESPACE (with TYPE BEARER)",
  note: "`.onNamespace()` scopes the access to the namespace. RECORD is database-only, so namespace/root access is JWT or BEARER. (Namespace-level introspection round-trip is a separate multi-level-access task.)",
  ddl: `DEFINE ACCESS api ON NAMESPACE TYPE BEARER FOR USER;`,
  def: defineAccess("api").onNamespace().bearer({ for: "user" }),
});
