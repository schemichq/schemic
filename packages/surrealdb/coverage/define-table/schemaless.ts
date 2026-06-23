import { defineTable } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "SCHEMALESS — allow undeclared fields",
  note: "`.schemaless()` opts out of the default SCHEMAFULL; records may carry fields beyond the declared shape.",
  ddl: `DEFINE TABLE thing TYPE NORMAL SCHEMALESS;`,
  def: defineTable("thing").schemaless(),
});
