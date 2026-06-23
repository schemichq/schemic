import { defineTable } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "CHANGEFEED … INCLUDE ORIGINAL — keep the prior row state",
  note: "`.changefeed(duration, { includeOriginal: true })` records the before-image alongside each change.",
  ddl: `DEFINE TABLE thing TYPE NORMAL SCHEMAFULL CHANGEFEED 1h INCLUDE ORIGINAL;`,
  def: defineTable("thing").changefeed("1h", { includeOriginal: true }),
});
