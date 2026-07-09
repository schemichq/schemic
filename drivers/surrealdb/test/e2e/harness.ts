// End-to-end harness: drive the real `schemic` CLI as a subprocess against a throwaway in-memory
// SurrealDB, in a throwaway project directory. This exercises the WHOLE app — arg parsing, config
// loading, jiti schema loading, the live DB, and the exact stdout/exit-code a user would see —
// rather than calling command functions directly (which we can't anyway: the CLI calls
// `process.exit`). One ephemeral `surreal` server is shared per test file; each test gets its own
// database (isolation) and its own scaffolded project dir.
import { setDefaultTimeout } from "bun:test";

// The workspace gate runs every package's suite IN PARALLEL — PGlite's CPU burst can slow live
// connects/DDL far past bun's default, timing out hooks (reported as "(unnamed)" tests). Live work
// gets a generous ceiling; isolated runs are unaffected.
//
// CAVEAT — this call only reaches the FIRST test file that imports this module. bun resets the
// default timeout per test FILE, but the module is evaluated ONCE (import cache), so every later
// e2e file silently falls back to bun's 5s hook default. That is what made `three-state`'s
// `afterAll` fail as "(unnamed) [5000.01ms] a beforeEach/afterEach hook timed out" in full-suite
// runs while passing when run alone. Hooks therefore pass their timeout EXPLICITLY; keep it that
// way, and don't trust this line to cover a hook you add.
setDefaultTimeout(120_000);

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  type EphemeralServer,
  spawnEphemeralServer,
  surrealBinaryAvailable,
} from "../../src/cli/engine";

/** drivers/surrealdb — this package's root (this file is test/e2e/harness.ts). */
export const SURREAL_PKG = resolve(import.meta.dir, "../..");
/** packages/ — where core + cli live; the driver packages now live in drivers/ (see SURREAL_PKG). */
const PKGS = resolve(import.meta.dir, "../../../..", "packages");
/** The `schemic` CLI entry — the CLI lives in its own @schemic/cli package now. */
const CLI = join(PKGS, "cli", "src/cli/index.ts");

/** Whether the e2e suite can run (needs the local `surreal` binary for the in-memory server). */
export const E2E_ENABLED = surrealBinaryAvailable();

// ANSI SGR escapes (built at runtime so the source carries no literal control char).
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const strip = (s: string): string => s.replace(ANSI, "");

export interface CliResult {
  /** Exit code (0 = success). `diff` exits 0 even when it reports drift; only `check` exits 1. */
  code: number;
  stdout: string;
  stderr: string;
  /** stdout + stderr, ANSI-stripped — what the user effectively sees. */
  out: string;
  /** The argv this result came from — named in {@link ok}'s failure message. */
  argv: readonly string[];
}

/**
 * Assert the CLI call SUCCEEDED, and on failure report what it actually said.
 *
 * `expect(r.code).toBe(0)` prints only "Expected: 0 / Received: 1" and throws the subprocess's
 * output away — which is precisely the information needed when a run fails on CI and not locally.
 * Every e2e assertion of success goes through here so an intermittent failure is self-diagnosing
 * from the log alone.
 */
export function ok(r: CliResult): CliResult {
  if (r.code !== 0) {
    const say = (label: string, text: string) =>
      text.trim() ? `\n--- ${label} ---\n${text.trim()}` : "";
    throw new Error(
      `sc ${r.argv.join(" ")} exited ${r.code} (expected 0)${say("stdout", r.stdout)}${say("stderr", r.stderr)}`,
    );
  }
  return r;
}

/**
 * A running e2e context: one shared ephemeral server + helpers to scaffold projects, invoke the
 * CLI, and read/write schema files. Created in `beforeAll`, torn down in `afterAll`.
 */
export interface Harness {
  url: string;
  /** A fresh, unique database name (the server is shared; the database isolates each test). */
  freshDb(): string;
  /** Scaffold an empty project dir with a node_modules symlink farm so `@schemic/core` resolves. */
  scaffold(): string;
  /** Run `schemic <args>` in `cwd`, pointed at database `db`. Extra `env` overrides the defaults. */
  run(
    args: string[],
    opts: { cwd: string; db: string; env?: Record<string, string> },
  ): Promise<CliResult>;
  /** Read a project file (relative to its root). */
  read(root: string, rel: string): string;
  /** Write a project file (relative to its root), creating parent dirs. */
  write(root: string, rel: string, content: string): void;
  /** Stop the server and remove every scaffolded project dir. */
  cleanup(): Promise<void>;
}

/**
 * Build the node_modules symlink farm so a scaffolded project's `import "@schemic/surrealdb"` resolves
 * to THIS workspace source (bun -> src export, one module instance), along with its @schemic/core +
 * surrealdb + zod deps.
 */
function linkDeps(root: string): void {
  const nm = join(root, "node_modules");
  mkdirSync(join(nm, "@schemic"), { recursive: true }); // scoped pkg needs its scope dir
  symlinkSync(SURREAL_PKG, join(nm, "@schemic", "surrealdb"));
  symlinkSync(join(PKGS, "core"), join(nm, "@schemic", "core"));
  for (const dep of ["surrealdb", "zod"]) {
    symlinkSync(
      realpathSync(join(SURREAL_PKG, "node_modules", dep)),
      join(nm, dep),
    );
  }
}

/** Start a shared ephemeral server and return the bound helper set. */
export async function startHarness(): Promise<Harness> {
  const server: EphemeralServer = await spawnEphemeralServer();
  const roots: string[] = [];
  let dbN = 0;

  const run: Harness["run"] = async (args, opts) => {
    const proc = Bun.spawn(["bun", "run", CLI, ...args], {
      cwd: opts.cwd,
      env: {
        ...process.env,
        SURREAL_URL: server.url,
        SURREAL_NAMESPACE: "e2e",
        SURREAL_DATABASE: opts.db,
        SURREAL_USER: server.username,
        SURREAL_PASS: server.password,
        SURREAL_AUTH_LEVEL: "root",
        NO_COLOR: "1",
        ...opts.env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return {
      code,
      stdout: strip(stdout),
      stderr: strip(stderr),
      out: strip(`${stdout}${stderr}`),
      argv: args,
    };
  };

  return {
    url: server.url,
    freshDb: () => `t${++dbN}`,
    scaffold() {
      const root = mkdtempSync(join(tmpdir(), "s-e2e-"));
      linkDeps(root);
      roots.push(root);
      return root;
    },
    run,
    read: (root, rel) => readFileSync(join(root, rel), "utf8"),
    write(root, rel, content) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    },
    async cleanup() {
      for (const r of roots) rmSync(r, { recursive: true, force: true });
      await server.stop();
    },
  };
}

// --- Schema fixtures ---------------------------------------------------------------------------
// Small helpers to author the per-table schema files the directory layout expects.

/** A `database/schema/tables/<name>.ts` module exporting `export const <Export> = defineTable(...)`. */
export function tableFile(body: string): string {
  return body.endsWith("\n") ? body : `${body}\n`;
}

/** The `user` table the sample schema ships with, optionally with extra field lines spliced in. */
export function userSchema(extraFields = ""): string {
  return `import { surql } from "surrealdb";
import { s, defineTable } from "@schemic/surrealdb";

export const User = defineTable("user", {
  id: s.string(),
  name: s.string(),
  email: s.email(),${extraFields ? `\n${extraFields}` : ""}
  createdAt: s.datetime().$default(surql\`time::now()\`).$readonly(),
});
`;
}
