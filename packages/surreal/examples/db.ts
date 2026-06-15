import { Surreal } from "surrealdb";

/**
 * Connect to the live instance. Credentials come from the environment so no
 * secret lives in source; "root" is only a dev fallback. Pass SURREAL_PASS
 * (and optionally SURREAL_URL/USER/NS/DB) when running.
 */
export async function connect(): Promise<Surreal> {
  const db = new Surreal();
  await db.connect(process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc");
  await db.signin({
    username: process.env.SURREAL_USER ?? "root",
    password: process.env.SURREAL_PASS ?? "root",
  });
  await db.use({
    namespace: process.env.SURREAL_NS ?? "@schemic/surreal",
    database: process.env.SURREAL_DB ?? "pure",
  });
  return db;
}
