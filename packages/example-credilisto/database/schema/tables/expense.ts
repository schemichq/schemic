import { sz, defineTable } from "surreal-zod";
import { surql } from "surrealdb";

export const Expense = defineTable("expense", {
  id: sz.string(),
  amount: sz.number(),
  category: sz.enum(["oficina", "transporte", "comida", "servicios", "marketing", "legal", "tecnologia", "otros"]).optional(),
  createdAt: sz.any().$default(surql`time::now()`),
  createdBy: sz.any(),
  description: sz.string(),
  expenseDate: sz.datetime(),
  notes: sz.string().optional(),
  updatedAt: sz.any().$default(surql`time::now()`),
})
  .typeAny();
