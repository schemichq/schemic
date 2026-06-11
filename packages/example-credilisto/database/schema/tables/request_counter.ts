import { sz, defineTable } from "surreal-zod";

export const RequestCounter = defineTable("request_counter", {
  id: sz.string(),
  value: sz.number(),
})
  .typeAny();
