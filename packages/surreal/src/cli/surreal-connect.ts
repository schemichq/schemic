// SurrealDB connection runtime — split out of cli/config.ts so that module stays dialect-neutral
// (config types + loadConfig only). This is the Surreal driver's `connect` implementation; it imports
// the surrealdb SDK and belongs to @schemic/surreal at the physical split.

import type { ConnectionOverrides, ResolvedConfig } from "@schemic/core";
import type { AuthLevel } from "@schemic/core/config";
import { escapeIdent, Surreal } from "surrealdb";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const CONNECT_TIMEOUT_MS = 5_000;

/** Reject if `promise` doesn't settle within `ms` — guards against a hung connect. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Connect + authenticate + select the namespace/database. Caller closes the handle. */
export async function connect(
  config: ResolvedConfig,
  over: ConnectionOverrides = {},
): Promise<Surreal> {
  const url = over.url ?? config.db.url;
  const namespace = over.namespace ?? config.db.namespace;
  const database = over.database ?? config.db.database;
  const username = over.username ?? config.db.username;
  const password = over.password ?? config.db.password;
  const level: AuthLevel = (over.authLevel ??
    config.db.authLevel ??
    "root") as AuthLevel;

  const db = new Surreal();
  // On ANY failure, close the handle before throwing — otherwise the SDK's reconnect timer
  // keeps the event loop alive and the command hangs instead of exiting.
  try {
    try {
      // `reconnect: false` so a dead server rejects immediately instead of entering a retry
      // loop; `withTimeout` is a fallback for an unreachable host that never rejects.
      await withTimeout(
        db.connect(url, { reconnect: false }),
        CONNECT_TIMEOUT_MS,
        "connection timed out",
      );
    } catch (e) {
      throw new Error(
        `Can't reach SurrealDB at ${url} — is the server running? (${errMsg(e)})`,
      );
    }
    if (username && password) {
      // Scope the signin to the requested level (mirrors `surreal sql --auth-level`).
      const auth =
        level === "root"
          ? { username, password }
          : level === "namespace"
            ? { namespace, username, password }
            : { namespace, database, username, password };
      try {
        await db.signin(auth);
      } catch (e) {
        throw new Error(
          `Authentication failed (auth level "${level}") — check SURREAL_USER / SURREAL_PASS. (${errMsg(e)})`,
        );
      }
    }
    // Best-effort: create the namespace/database when we likely have the rights. A `database`
    // user can't define either; a `namespace` user can define databases; `root` can do both.
    try {
      if (level === "root") {
        await db.query(
          `DEFINE NAMESPACE IF NOT EXISTS ${escapeIdent(namespace)};`,
        );
      }
      if (level !== "database") {
        await db.use({ namespace });
        await db.query(
          `DEFINE DATABASE IF NOT EXISTS ${escapeIdent(database)};`,
        );
      }
    } catch {
      // insufficient privileges — assume the namespace/database already exist
    }
    try {
      await db.use({ namespace, database });
    } catch (e) {
      throw new Error(
        `Couldn't select ${namespace}/${database} — does it exist and do you have access? (${errMsg(e)})`,
      );
    }
    return db;
  } catch (e) {
    // Fire-and-forget: closing a half-open socket can be slow; don't block the error path.
    void db.close().catch(() => {});
    throw e;
  }
}
