import { sz, defineRelation } from "surreal-zod";
import { Loan } from "./loan";
import { User } from "./user";

export const Has = defineRelation("has", {

})
  .from(User)
  .to(Loan)
  .schemaless();
