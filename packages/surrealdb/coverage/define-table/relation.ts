import { defineRelation } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "TYPE RELATION — an edge table (unrestricted endpoints)",
  note: "defineRelation declares a graph edge; the edge shape is optional. Without .from()/.to() any record may sit on either end.",
  ddl: `DEFINE TABLE likes TYPE RELATION SCHEMAFULL;`,
  def: defineRelation("likes"),
});
