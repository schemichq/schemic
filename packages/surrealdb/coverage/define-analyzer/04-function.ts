import { defineAnalyzer } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "FUNCTION — a custom tokenizing function (fn::…)",
  note: "FUNCTION runs a custom fn:: before the tokenizers; it slots first in the clause order. .function() accepts a defineFunction reference (preferred — renameable) or the name with/without the `fn::` prefix; either way it emits `FUNCTION fn::<name>`.",
  ddl: `DEFINE ANALYZER custom FUNCTION fn::my_tokenizer;`,
  def: defineAnalyzer("custom").function("my_tokenizer"),
});
