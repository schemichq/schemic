import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "FLEXIBLE — an object field that allows arbitrary nested keys",
  note: "`.flexible()` (object-only) emits the postfix `TYPE object FLEXIBLE` — the canonical 3.1.x form SurrealDB serializes back from INFO (so it round-trips). Declared subfields still emit their own DEFINE FIELD.",
  ddl: `DEFINE TABLE doc TYPE NORMAL SCHEMAFULL;
DEFINE FIELD meta ON TABLE doc TYPE object FLEXIBLE;
DEFINE FIELD meta.tag ON TABLE doc TYPE string;`,
  def: defineTable("doc", {
    meta: s.object({ tag: s.string() }).flexible(),
  }).schemafull(),
});
