import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import type { SurrealZodCheckEmbedded } from "@schemic/core/config";
import { escapeIdent, Surreal } from "surrealdb";

/** Pick a free localhost TCP port by binding to :0 and reading it back. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no port"))));
    });
  });
}

/** Whether the local `surreal` CLI is runnable (used to pick the `auto` check engine). */
export function surrealBinaryAvailable(bin = "surreal"): boolean {
  try {
    execFileSync(bin, ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export interface EphemeralServer {
  url: string;
  username: string;
  password: string;
  /** Stop the spawned process (idempotent). */
  stop: () => Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll a Surreal connection until it succeeds, the process dies, or we time out. */
async function waitUntilReady(
  url: string,
  username: string,
  password: string,
  child: ChildProcess,
  stderr: () => string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `surreal exited (${child.exitCode}): ${stderr().split("\n").filter(Boolean).pop() ?? "no output"}`,
      );
    }
    const db = new Surreal();
    try {
      await db.connect(url, { reconnect: false });
      await db.signin({ username, password });
      await db.close();
      return;
    } catch {
      await db.close().catch(() => {});
      await sleep(100);
    }
  }
  throw new Error("surreal did not become ready within 15s");
}

/**
 * Spawn an ephemeral in-memory SurrealDB using the local `surreal` binary — for `schemic check`'s
 * migration replay. It runs on the user's EXACT SurrealDB version, needs no external server, and
 * never touches their data. Capabilities are fully allowed (`--allow-all`): it's a throwaway
 * instance running the user's own schema, so asserts/defaults/scripted functions all work. The
 * caller must `stop()` it (a `process.exit` hook is also registered as a backstop).
 */
export async function spawnEphemeralServer(
  bin = "surreal",
): Promise<EphemeralServer> {
  const port = await freePort();
  const username = "root";
  const password = "root";
  const child = spawn(
    bin,
    [
      "start",
      "--bind",
      `127.0.0.1:${port}`,
      "--username",
      username,
      "--password",
      password,
      "--allow-all",
      "memory",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr += String(d);
  });

  let stopped = false;
  const stop = (): Promise<void> =>
    new Promise((resolve) => {
      if (stopped || child.exitCode !== null) {
        stopped = true;
        return resolve();
      }
      stopped = true;
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
      // Hard-kill if it doesn't exit promptly.
      setTimeout(() => child.kill("SIGKILL"), 2000).unref?.();
    });
  // Backstop: don't leak the process if the CLI exits abnormally.
  const onExit = () => {
    if (!stopped) child.kill("SIGKILL");
  };
  process.once("exit", onExit);

  const url = `ws://127.0.0.1:${port}/rpc`;
  try {
    await waitUntilReady(url, username, password, child, () => stderr);
  } catch (e) {
    await stop();
    throw e;
  }
  return { url, username, password, stop };
}

export interface EmbeddedConnection {
  db: Surreal;
  /** A display label for the engine, e.g. `embedded memory`. */
  url: string;
  stop: () => Promise<void>;
}

/**
 * Connect to an EMBEDDED in-process SurrealDB via the optional `@surrealdb/node` package, selecting
 * the `cfg.backend` storage and passing `cfg` (capabilities, timeouts, …) straight to
 * `createNodeEngines`. Creates/selects the given namespace/database so the replay can run. The
 * package is imported lazily (a non-literal specifier) so it's never required unless this engine is
 * used; a clear error tells the user to install it otherwise.
 */
export async function connectEmbedded(
  cfg: SurrealZodCheckEmbedded,
  namespace: string,
  database: string,
): Promise<EmbeddedConnection> {
  // Non-literal specifier so tsc/bundlers don't treat `@surrealdb/node` as a hard dependency.
  const pkg: string = "@surrealdb/node";
  let createNodeEngines: ((options?: unknown) => unknown) | undefined;
  try {
    const mod = (await import(pkg)) as {
      createNodeEngines?: (options?: unknown) => unknown;
    };
    createNodeEngines = mod.createNodeEngines;
  } catch {
    createNodeEngines = undefined;
  }
  if (!createNodeEngines) {
    throw new Error(
      'check.engine embedded mode needs `@surrealdb/node` — install it (e.g. `npm i -D @surrealdb/node`), or use a string engine ("auto" / "binary" / "remote").',
    );
  }

  const backend = cfg.backend ?? "memory";
  const scheme = backend === "memory" ? "mem" : backend;
  const url = `${scheme}://${cfg.path ?? ""}`;
  const engines = createNodeEngines({
    capabilities: cfg.capabilities ?? true,
    strict: cfg.strict,
    query_timeout: cfg.query_timeout,
    transaction_timeout: cfg.transaction_timeout,
  });
  // biome-ignore lint/suspicious/noExplicitAny: the SDK's `engines` option is loosely typed here.
  const db = new Surreal({ engines } as any);
  await db.connect(url);
  await db.query(`DEFINE NAMESPACE IF NOT EXISTS ${escapeIdent(namespace)}`);
  await db.use({ namespace });
  await db.query(`DEFINE DATABASE IF NOT EXISTS ${escapeIdent(database)}`);
  await db.use({ namespace, database });
  return {
    db,
    url: `embedded ${backend}`,
    stop: async () => {
      await db.close().catch(() => {});
    },
  };
}
