import { surql, Table, type Surreal } from "surrealdb";
import { User } from "./schema/tables/user";

/** Run with `surreal-zod seed`. Receives a connected client. */
export default async function seed(db: Surreal) {
  // await db.create(new Table(User.name)).content(User.encode({
  //   name: 'Manuel',
  //   email: 'Sánchez',
  // }));
  // await db.query(surql`SELECT * FROM Users`);
  // await db.create("user", { name: "Ada", email: "ada@example.com" });
}
