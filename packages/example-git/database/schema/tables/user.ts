import { s, surql, defineTable } from "@schemic/surrealdb";

export const User = defineTable("user", {
  id: s.string(),
  createdAt: s.datetime().$default(surql`time::now()`).$readonly(),
  email: s.string().$assert(surql`string::is_email($value)`),
  name: s.string().$assert(surql`string::len($value) >= 0`),
  role: s.enum(["user","admin"]),
});
