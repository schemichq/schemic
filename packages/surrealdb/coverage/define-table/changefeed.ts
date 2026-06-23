import { defineTable } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "CHANGEFEED — retain a change stream",
  note: "`.changefeed(duration)` keeps a replayable feed of row changes for the given retention window.",
  ddl: `DEFINE TABLE thing TYPE NORMAL SCHEMAFULL CHANGEFEED 1h;`,
  def: defineTable("thing").changefeed("1h"),
});
