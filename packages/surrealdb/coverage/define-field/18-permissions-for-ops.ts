import { defineTable, s, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "PERMISSIONS FOR <op> — per-operation rules (fields have no FOR delete)",
  note: "`.$permissions({ select, create, update })` — fields gate only select/create/update (no FOR delete; the parser rejects it). `true` -> `FOR select FULL`; ops sharing a WHERE collapse into one `FOR create, update WHERE …`.",
  ddl: `DEFINE TABLE doc TYPE NORMAL SCHEMAFULL;
DEFINE FIELD body ON TABLE doc TYPE string PERMISSIONS FOR select FULL FOR create, update WHERE $auth.id != NONE;`,
  def: defineTable("doc", {
    body: s.string().$permissions({
      select: true,
      create: surql`$auth.id != NONE`,
      update: surql`$auth.id != NONE`,
    }),
  }).schemafull(),
});
