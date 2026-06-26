import { defineTable, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "COMPUTED @expression",
  note: "`.$computed(surql`…`)` — emits `COMPUTED`, a derived read-only VIRTUAL column: never stored (a supplied value is discarded), evaluated lazily at read time from other fields, so always live. (Contrast VALUE, which is stored at write time.) The engine rejects COMPUTED combined with VALUE/ASSERT/REFERENCE/DEFAULT/READONLY.",
  ddl: `DEFINE TABLE person TYPE NORMAL SCHEMAFULL;
DEFINE FIELD fullName ON TABLE person TYPE string COMPUTED string::concat(first, ' ', last);`,
  def: defineTable("person", {
    fullName: s.string().$computed(surql`string::concat(first, ' ', last)`),
  }).schemafull(),
});
