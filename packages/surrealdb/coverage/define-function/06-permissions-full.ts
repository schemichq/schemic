import { defineFunction, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "PERMISSIONS FULL",
  note: "`.permissions(true)` emits `PERMISSIONS FULL` (the engine default — also what an omitted clause round-trips as).",
  ddl: `DEFINE FUNCTION fn::greet($name: string) { RETURN "hi " + $name } PERMISSIONS FULL;`,
  def: defineFunction("greet", { name: s.string() })
    .body(surql`RETURN "hi " + $name`)
    .permissions(true),
});
