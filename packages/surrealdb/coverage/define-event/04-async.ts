import { defineTable, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "ASYNC — fire off the write path",
  note: "`async: true` emits a bare `ASYNC` so the event runs asynchronously. SurrealDB materializes RETRY 1 / MAXDEPTH 3 defaults, which Schemic strips on emit so a bare ASYNC round-trips churn-free.",
  ddl: `DEFINE TABLE audit_cfg TYPE NORMAL SCHEMAFULL;
DEFINE FIELD entity ON TABLE audit_cfg TYPE string;
DEFINE EVENT on_change ON TABLE audit_cfg ASYNC THEN UPDATE $value.id SET seen = time::now();`,
  def: defineTable("audit_cfg", { entity: s.string() })
    .schemafull()
    .event("on_change", {
      async: true,
      then: surql`UPDATE $value.id SET seen = time::now()`,
    }),
});
