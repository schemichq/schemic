import { defineTable, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "ASSERT @expression",
  note: "`.$assert(surql`…`)` — emits `ASSERT`, a boolean constraint checked on every write (`$value` is the incoming value); the write is rejected when it's false.",
  ddl: `DEFINE TABLE user TYPE NORMAL SCHEMAFULL;
DEFINE FIELD age ON TABLE user TYPE number ASSERT $value >= 0;`,
  def: defineTable("user", {
    age: s.number().$assert(surql`$value >= 0`),
  }).schemafull(),
});
