import { defineTable } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "PERMISSIONS NONE — deny all record access",
  note: "`.permissions(false)` — no record-level access for any operation (root/owner still bypasses).",
  ddl: `DEFINE TABLE thing TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;`,
  def: defineTable("thing").permissions(false),
});
