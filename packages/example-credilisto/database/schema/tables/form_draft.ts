import { sz, defineTable } from "surreal-zod";
import { surql } from "surrealdb";

export const FormDraft = defineTable("form_draft", {
  id: sz.string(),
  createdAt: sz.any().$default(surql`time::now()`),
  data: sz.object({}).loose(),
  step: sz.number().optional(),
  updatedAt: sz.any().$default(surql`time::now()`),
  user: sz.any(),
})
  .typeAny();
