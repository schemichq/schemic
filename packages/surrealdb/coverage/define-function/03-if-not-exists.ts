import { defineFunction, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "IF NOT EXISTS — DEFINE FUNCTION IF NOT EXISTS …",
  note: 'Emit flag (DefineOptions.exists = "ignore") — `DEFINE FUNCTION IF NOT EXISTS fn::…` (a no-op when the function already exists).',
  ddl: `DEFINE FUNCTION IF NOT EXISTS fn::greet($name: string) { RETURN "hi " + $name };`,
  def: defineFunction("greet", { name: s.string() }).body(
    surql`RETURN "hi " + $name`,
  ),
  options: { exists: "ignore" },
});
