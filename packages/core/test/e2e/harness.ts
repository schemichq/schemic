// End-to-end harness: drive the real `schemic` CLI as a subprocess against a throwaway in-memory
// SurrealDB, in a throwaway project directory. This exercises the WHOLE app — arg parsing, config
// loading, jiti schema loading, the live DB, and the exact stdout/exit-code a user would see —
// rather than calling command functions directly (which we can't anyway: the CLI calls
// `process.exit`). One ephemeral `surreal` server is shared per test file; each test gets its own
// database (isolation) and its own scaffolded project dir.

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

/** packages/core — the @schemic/core package root (this file is test/e2e/harness.ts). */
export const CORE = resolve(import.meta.dir, "../..");
const CLI = join(CORE, "src/cli/index.ts");

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

/** Build the node_modules symlink farm (@schemic/core -> core, plus surrealdb + zod). */
function linkDeps(root: string): void {
  const nm = join(root, "node_modules");
  mkdirSync(join(nm, "@schemic"), { recursive: true }); // scoped pkg needs its scope dir
  symlinkSync(CORE, join(nm, "@schemic", "core"));
  for (const dep of ["surrealdb", "zod"]) {
    symlinkSync(realpathSync(join(CORE, "node_modules", dep)), join(nm, dep));
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
import { s, defineTable } from "@schemic/core";

export const User = defineTable("user", {
  id: s.string(),
  name: s.string(),
  email: s.email(),${extraFields ? `\n${extraFields}` : ""}
  createdAt: s.datetime().$default(surql\`time::now()\`).$readonly(),
});
`;
}
