import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "Base — DEFINE FIELD <name> ON TABLE <table> TYPE <type>",
  note: "A field is authored inline on a table via an `s.*` builder; emitTable emits its DEFINE FIELD after the table head. The `s.*` schema maps to the SurrealQL TYPE (here `s.string()` -> `string`).",
  ddl: `DEFINE TABLE product TYPE NORMAL SCHEMAFULL;
DEFINE FIELD name ON TABLE product TYPE string;`,
  def: defineTable("product", { name: s.string() }).schemafull(),
});
