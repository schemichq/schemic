import { defineTable } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "COUNT — a materialized row-count index",
  note: "`.index(name, [], { count: true })` — a fieldless `COUNT` index that materializes the table's row count for O(1) `count()`.",
  ddl: `DEFINE TABLE page TYPE NORMAL SCHEMAFULL;
DEFINE INDEX page_count_idx ON TABLE page COUNT;`,
  def: defineTable("page", {})
    .schemafull()
    .index("page_count_idx", [], { count: true }),
});
