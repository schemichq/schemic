import { defineFunction, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "PERMISSIONS WHERE @condition",
  note: "`.permissions(surql`…`)` emits `PERMISSIONS <expr>` — a record-user gate evaluated per call.",
  ddl: `DEFINE FUNCTION fn::greet($name: string) { RETURN "hi " + $name } PERMISSIONS $auth.admin = true;`,
  def: defineFunction("greet", { name: s.string() })
    .body(surql`RETURN "hi " + $name`)
    .permissions(surql`$auth.admin = true`),
});
