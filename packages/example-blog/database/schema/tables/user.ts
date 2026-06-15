import { defineTable, s, surql } from "@schemic/surreal";

export const User = defineTable("user", {
  id: s.string(),
  name: s.string().$assert(surql`string::len($value) > 0`),
  email: s.email().unique(),
  bio: s.string().optional(),
  createdAt: s.datetime().$default(surql`time::now()`).$readonly(),
});
