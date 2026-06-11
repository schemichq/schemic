import { sz, defineTable } from "surreal-zod";
import { surql } from "surrealdb";

export const RejectionReason = defineTable("rejection_reason", {
  id: sz.string(),
  createdAt: sz.any().$default(surql`time::now()`),
  displayOrder: sz.number().optional(),
  text: sz.string(),
})
  .typeAny();
