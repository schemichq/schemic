import { defineTable, s, surql } from "@schemic/surrealdb";
import { User } from "./user";

export const Post = defineTable("post", {
  id: s.string(),
  title: s.string().$assert(surql`string::len($value) > 0`),
  slug: s.string().unique(),
  body: s.string(),
  // A link to the author's `user` record (record<user> in SurrealQL).
  author: s.recordId(User),
  status: s.enum(["draft", "published", "archived"]).$default(surql`"draft"`),
  tags: s.array(s.string()).optional(),
  publishedAt: s.datetime().optional(),
  createdAt: s.datetime().$default(surql`time::now()`).$readonly(),
  // VALUE recomputes on every write, so it always reflects the last change.
  updatedAt: s.datetime().$value(surql`time::now()`),
});
