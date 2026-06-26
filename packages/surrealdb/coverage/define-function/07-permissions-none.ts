import { defineFunction, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "PERMISSIONS NONE",
  note: "`.permissions(false)` emits `PERMISSIONS NONE` — only root/owner may call the function.",
  ddl: `DEFINE FUNCTION fn::greet($name: string) { RETURN "hi " + $name } PERMISSIONS NONE;`,
  def: defineFunction("greet", { name: s.string() })
    .body(surql`RETURN "hi " + $name`)
    .permissions(false),
});
