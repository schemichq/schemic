import { defineFunction, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "No args — fn::<name>()",
  note: "`defineFunction(name)` with no args object emits an empty parameter list `()`.",
  ddl: `DEFINE FUNCTION fn::now() { RETURN time::now() };`,
  def: defineFunction("now").body(surql`RETURN time::now()`),
});
