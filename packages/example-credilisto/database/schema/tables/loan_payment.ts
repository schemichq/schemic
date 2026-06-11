import { sz, defineTable } from "surreal-zod";
import { surql } from "surrealdb";

export const LoanPayment = defineTable("loan_payment", {
  id: sz.string(),
  capitalPaid: sz.number(),
  createdAt: sz.any().$default(surql`time::now()`),
  interestPaid: sz.number(),
  invoiceNumber: sz.string().optional(),
  loan: sz.any(),
  notes: sz.string().optional(),
  paidAt: sz.datetime(),
  paymentMethod: sz.string().optional(),
  period: sz.number(),
  registeredBy: sz.any(),
  totalPaid: sz.number(),
})
  .typeAny();
