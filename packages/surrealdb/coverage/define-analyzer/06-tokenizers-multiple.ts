import { defineAnalyzer } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "TOKENIZERS — multiple, comma-joined",
  note: "SurrealDB's full tokenizer set (blank/class/camel/punct), applied in order and joined with `, `.",
  ddl: `DEFINE ANALYZER code TOKENIZERS BLANK, CLASS, CAMEL, PUNCT;`,
  def: defineAnalyzer("code").tokenizers("blank", "class", "camel", "punct"),
});
