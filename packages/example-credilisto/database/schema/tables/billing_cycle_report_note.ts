import { sz, defineTable } from "surreal-zod";
import { surql } from "surrealdb";

export const BillingCycleReportNote = defineTable("billing_cycle_report_note", {
  id: sz.string(),
  billingCycle: sz.any(),
  loan: sz.any(),
  note: sz.string(),
  updatedAt: sz.any().$default(surql`time::now()`),
  updatedBy: sz.any(),
})
  .typeAny();
