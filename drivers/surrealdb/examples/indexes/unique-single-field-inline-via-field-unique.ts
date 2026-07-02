import { defineTable, s } from "@schemic/surrealdb";
import { example } from "../_kit";

export default example(import.meta.url, {
  title: "UNIQUE (single field, inline via field.$unique())",
  note: "Field DDL clauses are `$`-prefixed; the index name is auto-derived `<table>_<field>_idx`.",
  ddl: `DEFINE TABLE u2 TYPE NORMAL SCHEMAFULL;
DEFINE FIELD email ON TABLE u2 TYPE string ASSERT string::is_email($value);
DEFINE INDEX u2_email_idx ON TABLE u2 FIELDS email UNIQUE;`,
  def: defineTable("u2", { id: s.string(), email: s.email().$unique() }),
});
