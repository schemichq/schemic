import { defineTable, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "ASYNC RETRY @retry MAXDEPTH @max_depth",
  note: "`async: { retry, maxDepth }` tunes the async knobs — `RETRY` re-runs on failure, `MAXDEPTH` caps cascade recursion. Only non-default values emit (default RETRY 1 / MAXDEPTH 3 are stripped).",
  ddl: `DEFINE TABLE audit_cfg TYPE NORMAL SCHEMAFULL;
DEFINE FIELD entity ON TABLE audit_cfg TYPE string;
DEFINE EVENT on_change ON TABLE audit_cfg ASYNC RETRY 3 MAXDEPTH 5 WHEN $event = "UPDATE" THEN CREATE audit_log SET at = time::now();`,
  def: defineTable("audit_cfg", { entity: s.string() })
    .schemafull()
    .event("on_change", {
      async: { retry: 3, maxDepth: 5 },
      when: surql`$event = "UPDATE"`,
      then: surql`CREATE audit_log SET at = time::now()`,
    }),
});
