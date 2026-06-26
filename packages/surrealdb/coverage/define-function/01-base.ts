import { defineFunction, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "Base — DEFINE FUNCTION fn::<name>(<args>) { <body> }",
  note: "`defineFunction(name, args).body(surql`…`)` — a custom function. Args become typed `$name: <type>` params; the body is a `surql` block. PERMISSIONS defaults to FULL in the engine, so an omitted clause round-trips as `PERMISSIONS FULL`.",
  ddl: `DEFINE FUNCTION fn::greet($name: string) { RETURN "hi " + $name };`,
  def: defineFunction("greet", { name: s.string() }).body(
    surql`RETURN "hi " + $name`,
  ),
});
