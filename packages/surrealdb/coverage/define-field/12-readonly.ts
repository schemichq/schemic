import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "READONLY",
  note: "`.$readonly()` — emits `READONLY`, an immutability flag: settable on create, then any UPDATE that changes it errors (commonly paired with VALUE/DEFAULT for a created_at).",
  ddl: `DEFINE TABLE account TYPE NORMAL SCHEMAFULL;
DEFINE FIELD ssn ON TABLE account TYPE string READONLY;`,
  def: defineTable("account", { ssn: s.string().$readonly() }).schemafull(),
});
