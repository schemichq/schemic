import { defineAnalyzer } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "FILTERS — a token-filter pipeline (typed builder callback)",
  note: "FILTERS run after tokenizing, in order. The `f => [...]` callback builds parameterized filters typesafely (f.snowball(lang), f.ngram(min,max)) with no extra import; all are uppercased whole to match INFO … STRUCTURE.",
  ddl: `DEFINE ANALYZER english TOKENIZERS CLASS FILTERS LOWERCASE, ASCII, SNOWBALL(ENGLISH), NGRAM(1,3);`,
  def: defineAnalyzer("english")
    .tokenizers("class")
    .filters((f) => [f.lowercase, f.ascii, f.snowball("english"), f.ngram(1, 3)]),
});
