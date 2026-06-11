import { sz, defineTable } from "surreal-zod";

export const Session = defineTable("session", {
  id: sz.string(),
  createdAt: sz.datetime(),
  expiresAt: sz.datetime(),
  updatedAt: sz.datetime(),
  user: sz.any(),
})
  .typeAny();
