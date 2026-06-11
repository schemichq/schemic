import { surql } from "surrealdb";
import { sz, defineTable } from "surreal-zod";

export const User = defineTable("user", {
  id: sz.string(),
  name: sz.string(),
  email: sz.email(),
  createdAt: sz.datetime().$default(surql`time::now()`).$readonly(),
});
