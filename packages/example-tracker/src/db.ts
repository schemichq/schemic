import { Surreal } from "surrealdb";

/**
 * Isomorphic connection config. Works in both Node/Bun (setup script, tests) and
 * the browser (Vite app). In Node, env vars can override the defaults; in the
 * browser `process` is undefined, so the constants below are used as-is.
 *
 * The browser never gets root credentials — it authenticates per-user via record
 * access (see `signUp`/`signIn`). Only `setup.ts`/tests sign in as root via env.
 */
export interface DbConfig {
  url: string;
  namespace: string;
  database: string;
  /** Name of the `DEFINE ACCESS ... TYPE RECORD` method used for signup/signin. */
  access: string;
}

const env = (key: string): string | undefined =>
  typeof process !== "undefined" ? process.env?.[key] : undefined;

export const DB: DbConfig = {
  url: env("SURREAL_URL") ?? "ws://127.0.0.1:8000/rpc",
  namespace: env("SURREAL_NS") ?? "schemic",
  database: env("SURREAL_DB") ?? "tracker",
  access: env("SURREAL_ACCESS") ?? "account",
};

/** Connect and select the namespace/database. No authentication yet. */
export async function connect(cfg: DbConfig = DB): Promise<Surreal> {
  const db = new Surreal();
  await db.connect(cfg.url);
  await db.use({ namespace: cfg.namespace, database: cfg.database });
  return db;
}

/** Sign up a new end user via record access, authenticating the connection. */
export async function signUp(
  db: Surreal,
  input: { name: string; email: string; pass: string },
  cfg: DbConfig = DB,
): Promise<string> {
  const tokens = await db.signup({
    namespace: cfg.namespace,
    database: cfg.database,
    access: cfg.access,
    variables: { name: input.name, email: input.email, pass: input.pass },
  });
  return tokens.access;
}

/** Sign in an existing end user via record access, authenticating the connection. */
export async function signIn(
  db: Surreal,
  input: { email: string; pass: string },
  cfg: DbConfig = DB,
): Promise<string> {
  const tokens = await db.signin({
    namespace: cfg.namespace,
    database: cfg.database,
    access: cfg.access,
    variables: { email: input.email, pass: input.pass },
  });
  return tokens.access;
}
