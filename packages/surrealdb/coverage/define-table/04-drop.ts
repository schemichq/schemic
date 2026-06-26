import { defineTable } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "DROP — discard writes (an append/compute-only table)",
  note: "`.drop()` — the table accepts no stored records; writes are dropped after triggering events/views.",
  ddl: `DEFINE TABLE thing TYPE NORMAL DROP SCHEMAFULL;`,
  def: defineTable("thing").drop(),
});
