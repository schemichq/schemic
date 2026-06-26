import { defineAnalyzer } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "TOKENIZERS — a single tokenizer",
  note: "TOKENIZERS splits input into terms before filtering. Names are uppercased to match INFO … STRUCTURE.",
  ddl: `DEFINE ANALYZER code TOKENIZERS BLANK;`,
  def: defineAnalyzer("code").tokenizers("blank"),
});
