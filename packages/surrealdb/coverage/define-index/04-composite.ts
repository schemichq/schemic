import { defineTable, s } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "Composite — multiple FIELDS",
  note: "`.index(name, [a, b])` — a multi-column index; the fields are comma-joined in `FIELDS a, b` (order is significant).",
  ddl: `DEFINE TABLE event TYPE NORMAL SCHEMAFULL;
DEFINE FIELD kind ON TABLE event TYPE string;
DEFINE FIELD at ON TABLE event TYPE datetime;
DEFINE INDEX event_kind_at_idx ON TABLE event FIELDS kind, at;`,
  def: defineTable("event", { kind: s.string(), at: s.datetime() })
    .schemafull()
    .index("event_kind_at_idx", ["kind", "at"]),
});
