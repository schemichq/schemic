import { defineTable, s, surql } from "@schemic/surrealdb";
import { Post } from "./post";
import { User } from "./user";

export const Comment = defineTable("comment", {
  id: s.string(),
  // The post this comment belongs to, and who wrote it.
  post: s.recordId(Post),
  author: s.recordId(User),
  body: s.string().$assert(surql`string::len($value) > 0`),
  createdAt: s.datetime().$default(surql`time::now()`).$readonly(),
});
