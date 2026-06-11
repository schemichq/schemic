import { sz, defineTable } from "surreal-zod";
import { Loan } from "./loan";
import { RejectionReason } from "./rejection_reason";
import { User } from "./user";
import { surql } from "surrealdb";

export const LoanRequest = defineTable("loan_request", (self) => ({
  id: sz.string(),
  checkNumber: sz.string().optional(),
  client: sz.any(),
  createdAt: sz.any().$default(surql`time::now()`),
  createdBy: User.record().optional(),
  editToken: sz.string().optional(),
  loan: Loan.record().optional(),
  notes: sz.string().optional(),
  paymentModel: sz.enum(["weekly", "biweekly", "monthly"]),
  previousRequest: self.optional(),
  recentPayment1: sz.number().optional(),
  recentPayment2: sz.number().optional(),
  recentPayment3: sz.number().optional(),
  recentPayment4: sz.number().optional(),
  recentPayment5: sz.number().optional(),
  recentPayment6: sz.number().optional(),
  refinanceCapitalPerPeriod: sz.number().optional(),
  refinanceFirstPaymentDate: sz.datetime().optional(),
  refinanceInterestRate: sz.number().optional(),
  refinanceLegalFees: sz.number().optional(),
  refinancePhoneFees: sz.number().optional(),
  rejectionNotes: sz.string().optional(),
  rejectionReason: RejectionReason.record().optional(),
  requestedAmount: sz.number(),
  source: sz.enum(["internal", "public"]).optional(),
  status: sz.enum(["pending", "approved", "rejected"]),
  updatedAt: sz.any().$default(surql`time::now()`),
}))
  .typeAny();
