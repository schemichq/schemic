import { defineFunction, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "OVERWRITE — DEFINE FUNCTION OVERWRITE …",
  note: 'Emit flag (DefineOptions.exists = "overwrite") — `DEFINE FUNCTION OVERWRITE fn::… `.',
  ddl: `DEFINE FUNCTION OVERWRITE fn::greet($name: string) { RETURN "hi " + $name };`,
  def: defineFunction("greet", { name: s.string() }).body(
    surql`RETURN "hi " + $name`,
  ),
  options: { exists: "overwrite" },
});
