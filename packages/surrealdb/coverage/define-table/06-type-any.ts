import { defineTable } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "TYPE ANY — accept any record shape",
  note: "`.typeAny()` — the table may hold normal records OR relations (NORMAL is the default; RELATION is a relation table).",
  ddl: `DEFINE TABLE thing TYPE ANY SCHEMAFULL;`,
  def: defineTable("thing").typeAny(),
});
