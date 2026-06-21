import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import * as p from "@clack/prompts";
// The @schemic versions this scaffolder pins are its OWN version (the packages release lockstep), so a
// fresh project always gets a matching set. Inlined at build by tsup.
import { version as SCHEMIC_VERSION } from "../package.json";

const RANGE = `^${SCHEMIC_VERSION}`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

/** Supported drivers: the package + the runtime deps a project authoring/connecting with it needs. */
const DRIVERS: Record<
  string,
  { label: string; pkg: string; deps: Record<string, string> }
> = {
  surrealdb: {
    label: "SurrealDB",
    pkg: "@schemic/surrealdb",
    deps: { surrealdb: "^2.0.3", zod: "^4.3.5" },
  },
  postgres: {
    label: "PostgreSQL (PGlite)",
    pkg: "@schemic/postgres",
    deps: { "@electric-sql/pglite": "^0.5.2", zod: "^4.3.5" },
  },
};
const DRIVER_NAMES = Object.keys(DRIVERS);
const PMS = ["bun", "npm", "pnpm", "yarn"] as const;
type Pm = (typeof PMS)[number];

interface Options {
  dir?: string;
  driver?: string;
  pm?: string;
  install?: boolean; // undefined = ask
  git: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): Options {
  const o: Options = { git: true, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-y" || a === "--yes") o.yes = true;
    else if (a === "--no-install") o.install = false;
    else if (a === "--no-git") o.git = false;
    else if (a === "--driver") o.driver = argv[++i];
    else if (a === "--pm") o.pm = argv[++i];
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else if (!a.startsWith("-") && o.dir === undefined) o.dir = a;
  }
  return o;
}

function printHelp(): void {
  console.log(`create-schemic — scaffold a new Schemic project

Usage: create-schemic [directory] [options]

Options:
  --driver <name>   ${DRIVER_NAMES.join(" | ")}
  --pm <name>       ${PMS.join(" | ")} (the package manager to install with)
  --no-install      scaffold only; don't install or run \`schemic init\`
  --no-git          don't run \`git init\`
  -y, --yes         accept defaults, no prompts
  -h, --help        show this help`);
}

/** Which package manager invoked us (from npm_config_user_agent), for a sensible default. */
function detectPm(): Pm {
  const ua = process.env.npm_config_user_agent ?? "";
  for (const pm of PMS) if (ua.startsWith(pm)) return pm;
  return "npm";
}

/** Abort cleanly on Ctrl-C / cancel from any prompt. */
function abortIfCancel<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Cancelled.");
    process.exit(1);
  }
  return value as T;
}

// --- templates ---------------------------------------------------------------------------------

function packageJson(name: string, driver: string, pm: Pm): string {
  const d = DRIVERS[driver];
  const deps: Record<string, string> = {
    "@schemic/cli": RANGE,
    [d.pkg]: RANGE,
    ...d.deps,
  };
  // pnpm's strict node_modules won't resolve a transitive @schemic/core, but the scaffolded config
  // imports `@schemic/core/config` — so under pnpm it must be a direct dependency.
  if (pm === "pnpm") deps["@schemic/core"] = RANGE;
  const sorted = Object.fromEntries(Object.entries(deps).sort());
  return `${JSON.stringify(
    {
      name,
      version: "0.0.0",
      private: true,
      type: "module",
      scripts: {
        "db:gen": "schemic gen",
        "db:diff": "schemic diff",
        "db:migrate": "schemic migrate",
        "db:status": "schemic status",
        "db:pull": "schemic pull",
        seed: "schemic seed",
      },
      dependencies: sorted,
      devDependencies: { "@types/node": "^20", typescript: "^5" },
    },
    null,
    2,
  )}\n`;
}

function tsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ESNext",
        module: "Preserve",
        moduleResolution: "bundler",
        moduleDetection: "force",
        strict: true,
        skipLibCheck: true,
        // for `import sql from "./x.surql" with { type: "text" }` + the scaffolded seeds.d.ts + JSON
        resolveJsonModule: true,
        noEmit: true,
        lib: ["ESNext"],
        types: ["node"],
      },
      exclude: ["node_modules"],
    },
    null,
    2,
  )}\n`;
}

const GITIGNORE = `node_modules/
.env
*.log
.DS_Store
`;

// --- write + run -------------------------------------------------------------------------------

function writeIfAbsent(dir: string, file: string, content: string): string {
  const path = join(dir, file);
  if (existsSync(path)) return dim(`· ${file} (exists, skipped)`);
  writeFileSync(path, content);
  return `+ ${file}`;
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
  capture = false,
): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: capture ? "pipe" : "inherit",
    encoding: "utf8",
  });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const tty = !!process.stdin.isTTY && !opts.yes;

  p.intro(bold("create-schemic"));

  // 1. directory / name
  let dir = opts.dir;
  if (!dir && tty) {
    dir = abortIfCancel(
      await p.text({
        message: "Project directory",
        placeholder: "schemic-app",
        defaultValue: "schemic-app",
      }),
    );
  }
  dir ||= "schemic-app";
  const target = resolve(process.cwd(), dir);
  const name = basename(target);
  mkdirSync(target, { recursive: true });
  if (readdirSync(target).length && tty) {
    const ok = abortIfCancel(
      await p.confirm({
        message: `${bold(dir)} is not empty — continue?`,
        initialValue: false,
      }),
    );
    if (!ok) {
      p.cancel("Aborted.");
      process.exit(1);
    }
  }

  // 2. driver
  let driver = opts.driver;
  if (!driver && tty) {
    driver = abortIfCancel(
      await p.select({
        message: "Database driver",
        options: DRIVER_NAMES.map((n) => ({
          value: n,
          label: DRIVERS[n].label,
        })),
        initialValue: "surrealdb",
      }),
    );
  }
  driver ||= "surrealdb";
  if (!DRIVERS[driver]) {
    p.cancel(`Unknown driver "${driver}". Known: ${DRIVER_NAMES.join(", ")}.`);
    process.exit(1);
  }

  // 3. install? + which package manager (ask, default = detected)
  const detected = detectPm();
  let install = opts.install;
  if (install === undefined)
    install = tty
      ? abortIfCancel(
          await p.confirm({
            message: "Install dependencies now?",
            initialValue: true,
          }),
        )
      : true;
  let pm: Pm = (opts.pm as Pm) ?? detected;
  if (install && !opts.pm && tty) {
    pm = abortIfCancel(
      await p.select({
        message: "Install with which package manager?",
        options: [detected, ...PMS.filter((x) => x !== detected)].map((m) => ({
          value: m,
          label: m === detected ? `${m} (detected)` : m,
        })),
        initialValue: detected,
      }),
    ) as Pm;
  }

  // 4. write the project envelope
  const written = [
    writeIfAbsent(target, "package.json", packageJson(name, driver, pm)),
    writeIfAbsent(target, "tsconfig.json", tsconfig()),
    writeIfAbsent(target, ".gitignore", GITIGNORE),
  ];
  p.log.step(
    `${bold(name)} ${dim(`(${DRIVERS[driver].label})`)}\n${written.join("\n")}`,
  );
  if (opts.git && !existsSync(join(target, ".git")))
    run("git", ["init", "-q"], target);

  // 5. install + compose on `schemic init` (which scaffolds config + database/ via the driver)
  if (install) {
    const s = p.spinner();
    s.start(`Installing dependencies with ${pm}`);
    const r = run(pm, ["install"], target, true);
    if (!r.ok) {
      s.stop(`${pm} install failed`);
      p.log.error(r.out.trim().split("\n").slice(-8).join("\n"));
      p.outro(`Fix the install, then run ${bold("schemic init")}.`);
      process.exit(1);
    }
    s.stop("Dependencies installed");
    p.log.step("Scaffolding the schema");
    const runtime = pm === "bun" ? "bun" : "node";
    const cliJs = join(
      target,
      "node_modules",
      "@schemic",
      "cli",
      "lib",
      "cli.js",
    );
    run(runtime, [cliJs, "init", "--driver", driver], target);
  }

  // 6. next steps
  const cd = dir === "." ? "" : `cd ${dir}\n`;
  const steps = install
    ? `${cd}cp .env.example .env   ${dim("# set your connection")}\n${pm} run db:gen\n${pm} run db:migrate`
    : `${cd}${pm} install\n${pm} exec schemic init --driver ${driver}\ncp .env.example .env\n${pm} run db:gen`;
  p.note(steps, "Next steps");
  p.outro(`${bold(name)} is ready.`);
}

main().catch((e: unknown) => {
  p.log.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
