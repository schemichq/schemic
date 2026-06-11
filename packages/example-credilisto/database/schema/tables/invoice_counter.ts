import { sz, defineTable } from "surreal-zod";

export const InvoiceCounter = defineTable("invoice_counter", {
  id: sz.string(),
  value: sz.number(),
})
  .typeAny();
