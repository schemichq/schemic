import { defineFunction, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "COMMENT @string",
  note: "`.comment(…)` stores a description on the function.",
  ddl: `DEFINE FUNCTION fn::greet($name: string) { RETURN "hi " + $name } COMMENT "greets a user";`,
  def: defineFunction("greet", { name: s.string() })
    .body(surql`RETURN "hi " + $name`)
    .comment("greets a user"),
});
