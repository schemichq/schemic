import { defineTable, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "VALUE @expression",
  note: "`.$value(surql`…`)` — emits `VALUE`, computed and STORED on every create+update (`$value` is the incoming user value, which it can override). Here it lowercases the email.",
  ddl: `DEFINE TABLE user TYPE NORMAL SCHEMAFULL;
DEFINE FIELD email ON TABLE user TYPE string VALUE string::lowercase($value);`,
  def: defineTable("user", {
    email: s.string().$value(surql`string::lowercase($value)`),
  }).schemafull(),
});
