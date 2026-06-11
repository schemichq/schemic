import { sz, defineTable } from "surreal-zod";
import { User } from "./user";
import { surql } from "surrealdb";

export const Loan = defineTable("loan", {
  id: sz.string(),
  approvedAmount: sz.number(),
  approvedBy: sz.any(),
  capitalPerPeriod: sz.number(),
  client: sz.any(),
  createdAt: sz.any().$default(surql`time::now()`),
  firstPaymentDate: sz.datetime(),
  interestRate: sz.number(),
  legalFees: sz.number(),
  loanRequest: sz.any(),
  paymentModel: sz.enum(["weekly", "biweekly", "monthly"]),
  phoneFees: sz.number().optional(),
  voidedAt: sz.datetime().optional(),
  voidedBy: User.record().optional(),
  voidedReason: sz.string().optional(),
})
  .typeAny();
