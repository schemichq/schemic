import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { Surreal } from "surrealdb";

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
 * Spawn an ephemeral in-memory SurrealDB using the local `surreal` binary — for `sz check`'s
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
