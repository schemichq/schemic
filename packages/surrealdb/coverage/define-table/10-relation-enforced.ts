import { defineRelation, defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

const Person = defineTable("person", { id: s.string() });
const Product = defineTable("product", { id: s.string() });

export default cover(import.meta.url, {
  title: "TYPE RELATION … ENFORCED — require both endpoints to exist",
  note: ".enforced() — RELATE fails unless both the in and out records exist.",
  ddl: `DEFINE TABLE likes TYPE RELATION FROM person TO product ENFORCED SCHEMAFULL;`,
  def: defineRelation("likes").from(Person).to(Product).enforced(),
});
