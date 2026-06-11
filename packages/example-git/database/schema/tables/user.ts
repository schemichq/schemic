import { sz, surql, defineTable } from "surreal-zod";

export const User = defineTable("user", {
  id: sz.string(),
  createdAt: sz.datetime().$default(surql`time::now()`).$readonly(),
  email: sz.string().$assert(surql`string::is_email($value)`),
  name: sz.string().$assert(surql`string::len($value) >= 0`),
});
