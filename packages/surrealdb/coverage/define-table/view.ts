import { defineView, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "AS SELECT — a pre-computed view (shapeless)",
  note: "defineView(name).as(query) emits a TYPE ANY SCHEMALESS table whose rows are kept in sync with the SELECT.",
  ddl: `DEFINE TABLE active TYPE ANY SCHEMALESS AS SELECT name FROM person;`,
  def: defineView("active").as(surql`SELECT name FROM person`),
});
