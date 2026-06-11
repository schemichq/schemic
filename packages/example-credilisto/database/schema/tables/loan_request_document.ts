import { sz, defineTable } from "surreal-zod";
import { surql } from "surrealdb";

export const LoanRequestDocument = defineTable("loan_request_document", {
  id: sz.string(),
  createdAt: sz.any().$default(surql`time::now()`),
  expiresAt: sz.datetime().optional(),
  fileName: sz.string(),
  fileUrl: sz.string(),
  loanRequest: sz.any(),
  mimeType: sz.string(),
  sizeBytes: sz.number(),
  type: sz.string(),
  uploadedBy: sz.any(),
})
  .typeAny();
