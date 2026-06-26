import { defineTable, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "THEN ordered actions — THEN (a), (b)",
  note: "`then: [a, b]` runs multiple actions in order. A single THEN rides bare; several serialize as a parenthesized comma list `THEN (…), (…)` so the engine parses them as ordered actions (not one expression).",
  ddl: `DEFINE TABLE user TYPE NORMAL SCHEMAFULL;
DEFINE FIELD email ON TABLE user TYPE string;
DEFINE EVENT audit ON TABLE user WHEN $event = "UPDATE" THEN (CREATE log SET at = time::now()), (UPDATE stats SET n += 1);`,
  def: defineTable("user", { email: s.string() })
    .schemafull()
    .event("audit", {
      when: surql`$event = "UPDATE"`,
      then: [
        surql`CREATE log SET at = time::now()`,
        surql`UPDATE stats SET n += 1`,
      ],
    }),
});
