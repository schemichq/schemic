import { sz, defineTable } from "surreal-zod";
import { LoanRequest } from "./loan_request";
import { surql } from "surrealdb";

export const LoanTopUp = defineTable("loan_top_up", {
  id: sz.string(),
  additionalAmount: sz.number().optional(),
  amount: sz.number().optional(),
  appliedToPeriod: sz.number(),
  createdAt: sz.any().$default(surql`time::now()`),
  createdBy: sz.any(),
  interestAmount: sz.number().optional(),
  invoiceNumber: sz.string().optional(),
  kind: sz.enum(["refinance", "quick_advance", "abono"]),
  loan: sz.any(),
  loanRequest: LoanRequest.record().optional(),
  newCapitalPerPeriod: sz.number().optional(),
  newFirstPaymentDate: sz.datetime().optional(),
  newInterestRate: sz.number().optional(),
  newLegalFees: sz.number().optional(),
  newPhoneFees: sz.number().optional(),
  newTotalAmount: sz.number().optional(),
  notes: sz.string().optional(),
})
  .typeAny();
