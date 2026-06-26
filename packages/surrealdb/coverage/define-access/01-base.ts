import { defineAccess } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "Base — DEFINE ACCESS <name> ON DATABASE TYPE RECORD",
  note: "`defineAccess(name).onDatabase()` — the scope is required (no implicit default); `TYPE RECORD` is the default kind (end users sign up / sign in directly).",
  ddl: `DEFINE ACCESS account ON DATABASE TYPE RECORD;`,
  def: defineAccess("account").onDatabase(),
});
