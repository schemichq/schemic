import { Surreal } from "surrealdb";

/** Reject if the connect handshake doesn't complete in time (a dead port can hang). */
const CONNECT_TIMEOUT = Number(process.env.SURREAL_CONNECT_TIMEOUT ?? 2000);

/**
 * Connect to a live SurrealDB for integration tests, or return `null` if none is
 * reachable so the live suite can skip cleanly (CI, machines without a DB).
 * Uses an isolated database ("test" by default) to avoid touching demo data.
 */
export async function tryConnect(): Promise<Surreal | null> {
  const db = new Surreal();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        await db.connect(process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc");
        await db.signin({
          username: process.env.SURREAL_USER ?? "root",
          password: process.env.SURREAL_PASS ?? "root",
        });
        await db.use({
          namespace: process.env.SURREAL_NS ?? "@schemic/surrealdb",
          database: process.env.SURREAL_TEST_DB ?? "test",
        });
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("connect timeout")),
          CONNECT_TIMEOUT,
        );
      }),
    ]);
    return db;
  } catch {
    await db.close().catch(() => {});
    return null;
  } finally {
    clearTimeout(timer);
  }
}
