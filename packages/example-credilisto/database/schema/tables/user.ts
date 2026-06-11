import { sz, defineTable } from "surreal-zod";
import { surql } from "surrealdb";

export const User = defineTable("user", {
  id: sz.string(),
  createdAt: sz.any().$default(surql`time::now()`),
  email: sz.string(),
  image: sz.string().optional(),
  name: sz.string(),
  password: sz.any().$value(surql`crypto::bcrypt::generate($value)`),
  updatedAt: sz.any().$default(surql`time::now()`),
})
  .typeAny();
