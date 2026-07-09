// SurrealDB connection runtime — split out of cli/config.ts so that module stays dialect-neutral
// (config types + loadConfig only). This is the Surreal driver's `connect` implementation; it imports
// the surrealdb SDK and belongs to @schemic/surrealdb at the physical split.

import type { ConnectionOverrides, ResolvedConfig } from "@schemic/core";
import { escapeIdent, Surreal } from "surrealdb";
import type { AuthLevel, SurrealParams } from "../config";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const envMs = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Ceiling on the SDK's websocket connect. Generous ON PURPOSE: a busy machine can take many
 * seconds to complete the handshake against a perfectly healthy server, and a tight ceiling turns
 * that into a spurious "is the server running?" — under a loaded parallel test gate `sc migrate`
 * aborted at the old 5s while the server was up and answering.
 *
 * A DOWN server is not what this bounds; {@link assertReachable} catches that in ~a second. (The
 * SDK does not reject promptly on a refused port even with `reconnect: false` — measured: a closed
 * port burned the whole ceiling — so this alone cannot distinguish "down" from "slow".)
 */
const CONNECT_TIMEOUT_MS = envMs("SCHEMIC_CONNECT_TIMEOUT_MS", 30_000);

/** How long the pre-flight TCP probe waits before declaring the host unreachable. */
const PROBE_TIMEOUT_MS = envMs("SCHEMIC_PROBE_TIMEOUT_MS", 2_000);

/**
 * Pre-flight: can we even open a TCP socket to the endpoint? This is what makes a DOWN server fail
 * fast (~instantly on a refused port) while leaving the slow-but-alive case a generous
 * {@link CONNECT_TIMEOUT_MS} to finish its handshake. Non-TCP endpoints (`mem://`, `indxdb://`, a
 * URL we can't parse) are not probed — they simply skip to the SDK connect.
 */
async function assertReachable(url: string): Promise<void> {
  let host: string;
  let port: number;
  try {
    const u = new URL(url);
    if (!/^(wss?|https?):$/.test(u.protocol)) return; // not a TCP endpoint — nothing to probe
    host = u.hostname;
    port = Number(u.port) || (/^(wss|https):$/.test(u.protocol) ? 443 : 80);
  } catch {
    return; // unparseable — let the SDK produce the error
  }
  const { Socket } = await import("node:net");
  await new Promise<void>((resolve, reject) => {
    const sock = new Socket();
    const done = (err?: Error) => {
      sock.destroy();
      err ? reject(err) : resolve();
    };
    sock.setTimeout(PROBE_TIMEOUT_MS, () =>
      done(
        new Error(
          `no response from ${host}:${port} within ${PROBE_TIMEOUT_MS}ms`,
        ),
      ),
    );
    sock.once("error", (e) => done(e));
    sock.connect(port, host, () => done());
  });
}

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
  const params = config.params as unknown as SurrealParams;
  const url = over.url ?? params.url;
  const namespace = over.namespace ?? params.namespace;
  const database = over.database ?? params.database;
  const username = over.username ?? params.username;
  const password = over.password ?? params.password;
  const level: AuthLevel = (over.authLevel ??
    params.authLevel ??
    "root") as AuthLevel;

  const db = new Surreal();
  // On ANY failure, close the handle before throwing — otherwise the SDK's reconnect timer
  // keeps the event loop alive and the command hangs instead of exiting.
  try {
    try {
      // A DOWN host fails here, fast — the SDK's connect does NOT reject promptly on a refused
      // port (even with `reconnect: false`), so without this probe "server is down" and "server is
      // slow" are indistinguishable and both cost the full ceiling.
      await assertReachable(url);
      // `reconnect: false` so a failed connect doesn't enter a retry loop; `withTimeout` bounds a
      // host that accepts the socket but never finishes the handshake.
      await withTimeout(
        db.connect(url, { reconnect: false }),
        CONNECT_TIMEOUT_MS,
        `connection timed out after ${CONNECT_TIMEOUT_MS}ms`,
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
