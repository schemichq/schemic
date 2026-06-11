import { sz, defineTable } from "surreal-zod";
import { surql } from "surrealdb";

export const ClientDocument = defineTable("client_document", {
  id: sz.string(),
  client: sz.any(),
  createdAt: sz.any().$default(surql`time::now()`),
  expiresAt: sz.datetime().optional(),
  fileName: sz.string(),
  fileUrl: sz.string(),
  mimeType: sz.string(),
  preferred: sz.boolean().optional(),
  sizeBytes: sz.number(),
  type: sz.string(),
  uploadedBy: sz.any(),
})
  .typeAny();
