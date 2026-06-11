import { sz, defineTable } from "surreal-zod";
import { User } from "./user";
import { surql } from "surrealdb";

export const Company = defineTable("company", {
  id: sz.string(),
  archiveByDefault: sz.boolean().optional(),
  createdAt: sz.any().$default(surql`time::now()`),
  createdBy: User.record().optional(),
  name: sz.string(),
  normalizedName: sz.string(),
  notes: sz.string().optional(),
  updatedAt: sz.any().$default(surql`time::now()`),
})
  .typeAny()
  .index("companyNormalizedNameIdx", ["normalizedName"], { unique: true });
