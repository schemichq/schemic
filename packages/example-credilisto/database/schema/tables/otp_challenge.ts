import { sz, defineTable } from "surreal-zod";
import { surql } from "surrealdb";

export const OtpChallenge = defineTable("otp_challenge", {
  id: sz.string(),
  attempts: sz.any().$default(surql`0`),
  codeHash: sz.string(),
  createdAt: sz.any().$default(surql`time::now()`),
  expiresAt: sz.datetime(),
  loanRequest: sz.string(),
  phoneHint: sz.string(),
  salt: sz.string(),
  verifiedAt: sz.datetime().optional(),
})
  .typeAny();
