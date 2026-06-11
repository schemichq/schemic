import { sz, defineTable } from "surreal-zod";
import { User } from "./user";
import { surql } from "surrealdb";

export const BillingCycle = defineTable("billing_cycle", {
  id: sz.string(),
  closedAt: sz.datetime().optional(),
  closedBy: User.record().optional(),
  createdAt: sz.any().$default(surql`time::now()`),
  number: sz.number(),
  openedAt: sz.datetime(),
})
  .typeAny();
