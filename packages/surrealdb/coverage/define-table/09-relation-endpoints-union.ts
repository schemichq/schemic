import { defineRelation, defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

const Person = defineTable("person", { id: s.string() });

export default cover(import.meta.url, {
  title: "TYPE RELATION FROM a | b — a union of endpoint tables (mixed refs)",
  note: "An array endpoint emits a `|`-union; refs can mix TableDef / bare name / Table freely.",
  ddl: `DEFINE TABLE likes TYPE RELATION FROM person | company TO product SCHEMAFULL;`,
  def: defineRelation("likes").from([Person, "company"]).to("product"),
});
