import { defineTable, s, surql } from "@schemic/surrealdb";

// A SCHEMAFULL `user` table. Each field is a `s.*` builder (a drop-in for Zod's `z.*`) that also
// carries its SurrealQL DDL — `s.email()` emits `string ASSERT string::is_email(...)`, `.unique()`
// defines a UNIQUE index, `$default`/`$readonly` map to the DEFAULT / READONLY clauses.
export const User = defineTable("user", {
  name: s.string().$assert(surql`string::len($value) > 0`),
  email: s.email().unique(),
  bio: s.string().optional(),
  createdAt: s.datetime().$default(surql`time::now()`).$readonly(),
}).schemafull();
