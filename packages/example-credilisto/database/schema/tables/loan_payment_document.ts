import { sz, defineTable } from "surreal-zod";
import { LoanPayment } from "./loan_payment";
import { LoanTopUp } from "./loan_top_up";
import { surql } from "surrealdb";

export const LoanPaymentDocument = defineTable("loan_payment_document", {
  id: sz.string(),
  createdAt: sz.any().$default(surql`time::now()`),
  fileName: sz.string(),
  fileUrl: sz.string(),
  loanPayment: LoanPayment.record().optional(),
  loanTopUp: LoanTopUp.record().optional(),
  mimeType: sz.string(),
  sizeBytes: sz.number(),
  uploadedBy: sz.any(),
})
  .typeAny();
