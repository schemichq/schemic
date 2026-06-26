import { defineFunction, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "Return type — -> @type",
  note: "`.returns(schema)` declares the function's return type (an `s` schema, inferred like a field), emitted as `-> <type>` after the arg list.",
  ddl: `DEFINE FUNCTION fn::add($a: number, $b: number) -> number { RETURN $a + $b };`,
  def: defineFunction("add", { a: s.number(), b: s.number() })
    .returns(s.number())
    .body(surql`RETURN $a + $b`),
});
