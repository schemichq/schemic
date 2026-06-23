import { defineTable, surql } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "PERMISSIONS FOR select/create/update/delete — per-operation rules",
  note: "Each op takes true (FULL), false (NONE), or a surql WHERE expression — covering all four operations + all three value kinds.",
  ddl: `DEFINE TABLE thing TYPE NORMAL SCHEMAFULL PERMISSIONS FOR select FULL FOR create WHERE $auth.id != NONE FOR update WHERE $auth.id = id FOR delete NONE;`,
  def: defineTable("thing").permissions({
    select: true,
    create: surql`$auth.id != NONE`,
    update: surql`$auth.id = id`,
    delete: false,
  }),
});
