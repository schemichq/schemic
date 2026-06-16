import { defineTable, s, surql } from "@schemic/surrealdb";
import { User } from "./user";

// A `post` linked to its author. `s.recordId(User)` emits `record<user>`; the enum becomes a literal
// union; `$value` recomputes on every write (so `updatedAt` always reflects the last change).
export const Post = defineTable("post", {
  title: s.string().$assert(surql`string::len($value) > 0`),
  slug: s.string().unique(),
  body: s.string(),
  author: s.recordId(User),
  status: s.enum(["draft", "published", "archived"]).$default(surql`"draft"`),
  tags: s.array(s.string()).optional(),
  publishedAt: s.datetime().optional(),
  createdAt: s.datetime().$default(surql`time::now()`).$readonly(),
  updatedAt: s.datetime().$value(surql`time::now()`),
}).schemafull();
