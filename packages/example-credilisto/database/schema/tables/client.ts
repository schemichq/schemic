import { sz, defineTable } from "surreal-zod";
import { Company } from "./company";
import { User } from "./user";
import { surql } from "surrealdb";

export const Client = defineTable("client", {
  id: sz.string(),
  address: sz.object({
    number: sz.string(),
    province: sz.string(),
    reference: sz.string(),
    sector: sz.string(),
    street: sz.string(),
  }).optional(),
  archived: sz.boolean().$default(false),
  archivedReason: sz.string().optional(),
  banking: sz.object({
    accountNumber: sz.string(),
    bank: sz.string(),
    email: sz.string(),
    password: sz.string(),
    username: sz.string(),
  }).loose().optional(),
  birthdate: sz.datetime().optional(),
  contactDetails: sz.object({}).loose().array(),
  createdAt: sz.any().$default(surql`time::now()`),
  createdBy: User.record().optional(),
  employment: sz.object({
    company: sz.string(),
    companyAddress: sz.string(),
    companyPhone: sz.string(),
    companyPhoneExt: sz.string(),
    companyRef: Company.record().optional(),
    otherIncome: sz.number(),
    position: sz.string(),
    salary: sz.number(),
    startDate: sz.datetime(),
    supervisorMobile: sz.string(),
    supervisorName: sz.string(),
    supervisorPhone: sz.string(),
  }).optional(),
  housing: sz.object({}).loose().optional(),
  identification: sz.object({}).loose().array(),
  maritalStatus: sz.string().optional(),
  name: sz.object({
    family: sz.string(),
    given: sz.string(),
  }),
  otherDebts: sz.object({}).loose().array(),
  references: sz.object({}).loose().array(),
  status: sz.enum(["pending", "active"]).optional(),
  updatedAt: sz.any().$default(surql`time::now()`),
  vehicle: sz.object({}).loose().optional(),
})
  .typeAny();
