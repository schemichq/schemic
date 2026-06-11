import { sz, defineTable } from "surreal-zod";

export const LoanCounter = defineTable("loan_counter", {
  id: sz.string(),
  value: sz.number(),
})
  .typeAny();
