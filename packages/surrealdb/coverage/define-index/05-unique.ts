import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "UNIQUE",
  note: "`.$unique()` on a field (or `.index(name, fields, { unique: true })` on the table) emits the `UNIQUE` special clause — enforces no duplicate values; the index name auto-derives `<table>_<field>_idx`.",
  ddl: `DEFINE TABLE user TYPE NORMAL SCHEMAFULL;
DEFINE FIELD username ON TABLE user TYPE string;
DEFINE INDEX user_username_idx ON TABLE user FIELDS username UNIQUE;`,
  def: defineTable("user", { username: s.string().$unique() }).schemafull(),
});
