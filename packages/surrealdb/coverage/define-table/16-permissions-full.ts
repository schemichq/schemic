import { defineTable } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "PERMISSIONS FULL — allow all record access",
  note: "`.permissions(true)` — unrestricted record-level access for every operation.",
  ddl: `DEFINE TABLE thing TYPE NORMAL SCHEMAFULL PERMISSIONS FULL;`,
  def: defineTable("thing").permissions(true),
});
