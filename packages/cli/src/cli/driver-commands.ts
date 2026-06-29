// Dispatch for DRIVER-CONTRIBUTED CLI commands — `sc <kind> <verb> [args]` (e.g. surreal
// `sc access rotate <name>`, postgres `sc matview refresh <name>`). Core owns ONLY this mechanism:
// it discovers `driver.commands`, registers each under its kind, parses argv, resolves the connection,
// and dispatches to `command.run` with a CommandContext. The driver owns each kind/verb's meaning.
//
// Driver commands are DISCOVERED LAZILY: the driver is loaded from the project's config, so this
// registration runs (async) before `program.parse()`. With no config (e.g. `sc init`), it no-ops.

import { createInterface } from "node:readline/promises";
import {
  type CommandContext,
  type CommandIo,
  type DriverCommand,
  envSecretProvider,
  fail,
  getDriver,
  loadProject,
  ok,
  type ParsedCommandArgs,
  style,
} from "@schemic/core";
import type { Command } from "commander";
import { ensureDriver, type ResolveOpts, resolveOne } from "./resolve";

/** Stdio + prompt helpers handed to a command, so a driver never touches stdio directly. */
const io: CommandIo = {
  ok: (m) => console.log(ok(m)),
  fail: (m) => console.error(fail(m)),
  info: (m) => console.log(m),
  async prompt(question, opts) {
    if (!process.stdin.isTTY)
      throw new Error(
        `"${question}" needs an interactive terminal (no value was provided non-interactively)`,
      );
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      // `hidden` masks typed input (e.g. a password) so it never echoes to the screen.
      if (opts?.hidden) {
        const out = process.stdout;
        const onData = () => out.write("[2K\r");
        process.stdin.on("data", onData);
        try {
          return (await rl.question(`${question} `)).trim();
        } finally {
          process.stdin.off("data", onData);
        }
      }
      return (await rl.question(`${question} `)).trim();
    } finally {
      rl.close();
    }
  },
};

/** Pre-scan argv for `-c`/`--config <path>` so registration loads the right project's driver. */
function configFromArgv(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-c" || argv[i] === "--config") return argv[i + 1];
    if (argv[i].startsWith("--config="))
      return argv[i].slice("--config=".length);
  }
  return undefined;
}

/**
 * Parse a command's raw positionals + commander option bag into {@link ParsedCommandArgs}, per the
 * command's declared `args`. Core collects ALL positionals (the driver validates arity); flags become
 * a string (value-flag) or boolean. Throws if a `required` flag is missing. Pure — unit-testable.
 */
export function toParsedArgs(
  cmd: DriverCommand,
  positionals: string[],
  opts: Record<string, unknown>,
): ParsedCommandArgs {
  const flags: ParsedCommandArgs["flags"] = {};
  for (const f of cmd.args?.flags ?? []) {
    const v = opts[f.name];
    flags[f.name] = f.value
      ? (v as string | undefined)
      : (v as boolean) === true;
    if (f.required && (v === undefined || v === false))
      throw new Error(`\`sc ${cmd.kind} ${cmd.verb}\` requires --${f.name}`);
  }
  return { positionals, flags };
}

/** Register one driver command as `sc <kind> <verb>` under its (shared) kind group. */
function addCommand(
  kindGroup: Command,
  cmd: DriverCommand,
  resolveOpts: () => ResolveOpts,
): void {
  // Positionals are always collected raw (variadic) and the DRIVER validates arity; the declared
  // `args.positionals` shape only feeds the usage line + help.
  const usage = (cmd.args?.positionals ?? [])
    .map((p) => (p.required ? `<${p.name}>` : `[${p.name}]`))
    .join(" ");
  const verb = kindGroup
    .command(`${cmd.verb} [args...]`)
    .summary(cmd.summary)
    .description(usage ? `${cmd.summary}\n\nArguments: ${usage}` : cmd.summary);

  for (const f of cmd.args?.flags ?? []) {
    const flag = f.value ? `--${f.name} <value>` : `--${f.name}`;
    verb.option(flag, f.help ?? "");
  }

  verb.action(async (args: string[], opts: Record<string, unknown>) => {
    const parsed = toParsedArgs(cmd, args, opts);

    const config = await resolveOne(resolveOpts());
    const driver = getDriver(config.driver);
    const conn = await driver.connect(config);
    const ctx: CommandContext = {
      conn,
      config,
      io,
      secrets: envSecretProvider,
    };
    try {
      await cmd.run(ctx, parsed);
    } finally {
      await driver.close(conn);
    }
  });
}

/**
 * Discover + register the active driver's `commands` onto `program` as `sc <kind> <verb>`. Runs before
 * `program.parse()`; no-ops when there's no project config (the driver is unknown) or the driver
 * contributes none. `resolveOpts` reads the global addressing flags (`--connection`/`--config`) off the
 * invoked command at action time.
 */
export async function registerDriverCommands(program: Command): Promise<void> {
  let driverName: string;
  const configPath = configFromArgv(process.argv.slice(2));
  try {
    const { config } = await loadProject({ config: configPath });
    // Each connection entry carries its driver name directly (no resolve/connect needed): read it off
    // any entry. A project's connections share one driver, so the first is enough.
    const entry = Object.values(config.connections)[0] as
      | { driver?: string }
      | undefined;
    if (!entry?.driver) return;
    driverName = entry.driver;
  } catch {
    return; // no/invalid config (e.g. `sc init`) — driver commands simply aren't available
  }

  try {
    await ensureDriver(driverName);
  } catch {
    return;
  }
  const driver = getDriver(driverName);
  if (!driver.commands?.length) return;

  // Group verbs under a shared kind command, so `sc access rotate` + `sc access check` co-exist.
  const groups = new Map<string, Command>();
  const groupFor = (kind: string): Command => {
    let g = groups.get(kind);
    if (!g) {
      g = program
        .command(kind)
        .summary(`${style.bold(driverName)} ${kind} commands`)
        .description(
          `Driver-specific \`${kind}\` commands (from @schemic/${driverName}).`,
        );
      groups.set(kind, g);
    }
    return g;
  };

  // The invoked verb command carries the global addressing flags; read them at action time.
  const resolveOpts = (): ResolveOpts => {
    const opts = program.opts() as { connection?: string; config?: string };
    return { connection: opts.connection, config: opts.config ?? configPath };
  };

  for (const cmd of driver.commands) {
    addCommand(groupFor(cmd.kind), cmd, resolveOpts);
  }
}
