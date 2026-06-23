import { defineView, s, surql } from "@schemic/surrealdb";
import { example } from "../_kit";

export default example(import.meta.url, {
  title: "Pre-computed VIEW (AS SELECT)",
  note: "defineView(name, shape?).as(query) emits TYPE ANY SCHEMALESS AS <query>; SurrealDB keeps the rows in sync. The optional shape types the projected rows (App + decode) but emits no DEFINE FIELD.",
  ddl: `DEFINE TABLE adults TYPE ANY SCHEMALESS AS SELECT name, age FROM user WHERE age >= 18;`,
  def: defineView("adults", { name: s.string(), age: s.number() }).as(
    surql`SELECT name, age FROM user WHERE age >= 18`,
  ),
});
