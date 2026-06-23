import { defineView, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "AS SELECT — a typed view (shape types the rows)",
  note: "A shape on defineView(name, shape) types App<typeof View> + decode codecs but emits NO DEFINE FIELD — the DDL is identical to the shapeless view.",
  ddl: `DEFINE TABLE adults TYPE ANY SCHEMALESS AS SELECT name, age FROM person WHERE age >= 18;`,
  def: defineView("adults", { name: s.string(), age: s.number() }).as(
    surql`SELECT name, age FROM person WHERE age >= 18`,
  ),
});
