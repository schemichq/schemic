import { spawnSync } from "node:child_process";
import {
  existsSync,
  watch as fsWatch,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  actionLabel,
  applyPull,
  type Diff,
  type DiffItem,
  type Driver,
  duplicateTables,
  EMPTY_STORED,
  existingTables,
  type FilterOpts,
  fail,
  formatDiff,
  formatItems,
  formatPatch,
  getDriver,
  isEmptyDiff,
  type KindRegistry,
  kindFlags,
  lineDiff,
  listMigrations,
  loadDefs,
  loadSchemas,
  lowerSchema,
  ok,
  type PullFilePlan,
  type PullPlan,
  parseFilter,
  pipeThroughPager,
  plural,
  type ResolvedConfig,
  readSnapshot,
  resolvePager,
  snapshotObjects,
  style,
  summarizeKinds,
  unifiedDiff,
  writeSnapshot,
} from "@schemic/core";
import { Command, Help, Option } from "commander";
// The CLI's own version — sourced from package.json (inlined at build) so it never drifts from the
// published package version the way a hardcoded string does.
import { version as CLI_VERSION } from "../../package.json";
import { init } from "./init";
import {
  baseline,
  clearMigrationFiles,
  commitMigration,
  migrate,
  planMigration,
  prepareMigration,
  reconcileBaseline,
  rollback,
  seed,
  status,
  unlock,
} from "./migrate";
import { portableDiff } from "./portable-diff";
import {
  collectArg,
  ensureDriver,
  type ResolveOpts,
  resolveOne,
  resolveTargets,
} from "./resolve";

/** The driver a resolved connection uses (its package is loaded by the resolution engine). */
const activeDriver = (config: ResolvedConfig): Driver<unknown> =>
  getDriver(config.driver);

type CommonOpts = ResolveOpts;

/**
 * Resolve the addressed connection(s), connect each via its driver, run, and always close. With
 * `--all` (or a `--connection <name>` collection) this fans out over every target, printing a
 * `[connection]` header per run. The connection is OPAQUE here (`db: unknown`) — the orchestration
 * only ever hands it back to the SAME driver, so the CLI body never names a dialect's connection type.
 */
async function withDb(
  opts: CommonOpts,
  fn: (db: unknown, config: ResolvedConfig) => Promise<void>,
): Promise<void> {
  const targets = await resolveTargets(opts);
  for (const config of targets) {
    if (targets.length > 1) console.log(style.bold(`\n[${config.connection}]`));
    const driver = getDriver(config.driver);
    const db = await driver.connect(config, opts);
    try {
      await fn(db, config);
    } finally {
      await driver.close(db);
    }
  }
}

const errMsg = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/**
 * Render duplicate-table conflicts as `name — file, file` lines (files relative to `root`, a file
 * repeated `×N` when it defines the same name more than once). Shared by `check` and `doctor`.
 */
function formatDuplicates(dups: Map<string, string[]>, root: string): string[] {
  return [...dups].map(([name, files]) => {
    const counts = new Map<string, number>();
    for (const f of files) counts.set(f, (counts.get(f) ?? 0) + 1);
    const label = [...counts]
      .map(([f, n]) => {
        const rel = relative(root, f);
        return n > 1 ? `${rel} (×${n})` : rel;
      })
      .join(", ");
    return `${name} — ${label}`;
  });
}

const duplicateHeader = (n: number) =>
  `${plural(n, "table")} defined more than once (last definition silently wins):`;

/**
 * Run a command action, then exit. We force `process.exit` once it settles so a lingering
 * SDK connection handle can't keep the process alive (commands would otherwise hang). Watch
 * commands return a never-settling promise, so they keep running until SIGINT.
 */
function run(action: () => Promise<void>): void {
  action().then(
    () => process.exit(process.exitCode ?? 0),
    (err: unknown) => {
      console.error(`\n${fail(errMsg(err))}`);
      process.exit(1);
    },
  );
}

/** Prompt for a migration title; returns undefined when non-interactive (uses the default). */
async function promptTitle(): Promise<string | undefined> {
  if (!process.stdin.isTTY) return undefined;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question("Migration title: ")).trim();
    return answer || undefined;
  } finally {
    rl.close();
  }
}

/** A yes/no prompt; defaults to NO when non-interactive, so scripts must opt in via a flag. */
async function confirmPrompt(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return a === "y" || a === "yes";
  } finally {
    rl.close();
  }
}

/** The short dimmed summary under a diff (per-kind counts + optional pending count). */
function diffSummary(
  registry: KindRegistry,
  diff: Diff,
  opts: { live?: boolean },
  pending?: number,
): string {
  const summary: string[] = [];
  if (!isEmptyDiff(diff)) {
    const kinds = summarizeKinds(registry, diff.items ?? []);
    summary.push(
      `${plural(diff.up.length, "change")} ${opts.live ? "vs the live database" : "vs the snapshot"}${kinds ? ` — ${kinds}` : ""}.`,
    );
  }
  if (pending !== undefined)
    summary.push(`${plural(pending, "migration")} pending.`);
  return summary.length ? `\n${style.dim(summary.join("\n"))}` : "";
}

/** Print a diff (inline word-diff) plus its summary. */
function reportDiff(
  registry: KindRegistry,
  diff: Diff,
  opts: { down?: boolean; live?: boolean; full?: boolean; inline?: boolean },
  pending?: number,
): void {
  console.log(
    formatDiff(diff, { down: opts.down, full: opts.full, inline: opts.inline }),
  );
  const summary = diffSummary(registry, diff, opts, pending);
  if (summary) console.log(summary);
}

/**
 * Watch the schema directory and re-run `task` on each change (debounced, non-overlapping).
 * Runs once immediately, then blocks until SIGINT/SIGTERM, when `cleanup` runs. Never resolves.
 */
function watchLoop(
  config: ResolvedConfig,
  task: () => Promise<void>,
  cleanup?: () => Promise<unknown>,
): Promise<never> {
  return new Promise<never>(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let queued = false;
    const fire = async () => {
      if (running) {
        queued = true;
        return;
      }
      running = true;
      console.log(style.dim(`\n— ${new Date().toLocaleTimeString()} —`));
      try {
        await task();
      } catch (err) {
        console.error(fail(errMsg(err)));
      }
      running = false;
      if (queued) {
        queued = false;
        void fire();
      }
    };
    const watcher = fsWatch(
      config.schemaPath,
      { recursive: !config.schemaIsFile },
      () => {
        clearTimeout(timer);
        timer = setTimeout(() => void fire(), 150);
      },
    );
    console.log(
      style.dim(
        `Watching ${relative(config.root, config.schemaPath)} for changes — ctrl-c to stop.`,
      ),
    );
    void fire();
    const stop = () => {
      watcher.close();
      clearTimeout(timer);
      Promise.resolve(cleanup?.()).finally(() => process.exit(0));
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

const configFlag = (cmd: Command): Command =>
  cmd.option("-c, --config <path>", "path to schemic.config.ts");

const dbFlags = (cmd: Command): Command =>
  configFlag(cmd)
    .option(
      "--connection <name>",
      "target a specific connection (or <name>:<key> within a collection)",
    )
    .option("--all", "run against every connection (collections fanned out)")
    .option(
      "--arg <key=value>",
      "value passed to connection resolvers (repeatable)",
      collectArg,
      [],
    )
    .option("--url <url>", "override the connection endpoint")
    .option("--namespace <ns>", "override the namespace")
    .option("--database <db>", "override the database")
    .option("--username <user>", "override the auth username")
    .option("--password <pass>", "override the auth password")
    .addOption(
      new Option("--auth-level <level>", "auth level").choices([
        "root",
        "namespace",
        "database",
      ]),
    );

const program = new Command();
program
  .name("schemic")
  .description(
    "Schema-as-code migrations for any database — generate DDL, diff, and migrate via drivers",
  )
  .version(CLI_VERSION)
  .showHelpAfterError("(run `schemic --help` for usage)")
  .addHelpText(
    "after",
    `
Examples:
  $ schemic init                 scaffold database/ (schemas + migrations) + config
  $ schemic gen add_users        create a migration from schema changes
  $ schemic migrate              apply pending migrations
  $ schemic push --watch         keep the database in sync while you edit
  $ schemic diff --live          show how the schema differs from the live database
`,
  );

// Collapse negatable flags to a single `--[no-]flag` help line: drop the separate `--no-flag` line
// and prefix its positive (or a lone `--no-flag`) with `[no-]`. Set before any subcommand is added
// so they inherit it. `_collapsible` (positives that have a `--no-` counterpart) is computed in
// `visibleOptions` and read in `optionTerm` within the same render pass.
type CollapsibleHelp = { _collapsible?: Set<string> };
program.configureHelp({
  visibleOptions(cmd) {
    const opts = Help.prototype.visibleOptions.call(this, cmd);
    // `--tables` and `--no-tables` share an `attributeName()` ("tables"); `name()` does NOT.
    const negated = new Set(
      opts.filter((o) => o.negate).map((o) => o.attributeName()),
    );
    (this as CollapsibleHelp)._collapsible = new Set(
      [...negated].filter((n) =>
        opts.some((o) => !o.negate && o.attributeName() === n),
      ),
    );
    // Drop the `--no-x` rows whose positive `--x` we'll fold the `[no-]` into.
    return opts.filter(
      (o) =>
        !(
          o.negate &&
          (this as CollapsibleHelp)._collapsible?.has(o.attributeName())
        ),
    );
  },
  optionTerm(option) {
    const term = Help.prototype.optionTerm.call(this, option);
    // A lone `--no-x` (no positive counterpart, e.g. `--no-prune`) -> `--[no-]x`.
    if (option.negate) return term.replace("--no-", "--[no-]");
    // A positive `--x` that has a `--no-x` counterpart -> `--[no-]x [...]`.
    if ((this as CollapsibleHelp)._collapsible?.has(option.attributeName()))
      return term.replace(`--${option.name()}`, `--[no-]${option.name()}`);
    return term;
  },
});

program
  .command("init")
  .description("Scaffold database/ (schemas + migrations) and a config file")
  .option(
    "--driver <name>",
    "database driver to scaffold for (default surrealdb)",
  )
  .action((opts: { driver?: string }) => {
    run(async () => {
      const name = opts.driver ?? "surrealdb";
      try {
        await ensureDriver(name);
      } catch (e) {
        // The driver isn't installed → this project isn't set up yet. Hand off to create-schemic,
        // which writes the project envelope (package.json/tsconfig), installs the driver, and re-runs
        // init — working for a bare OR an existing project. The env guard breaks any re-forward loop
        // if the driver is present-but-unloadable (create-schemic sets it on the inner init).
        if (process.env.SCHEMIC_NO_BOOTSTRAP) throw e;
        console.log(
          style.dim(
            "This project isn't set up for Schemic yet — bootstrapping with create-schemic…\n",
          ),
        );
        const runner = process.versions.bun ? ["bun", "x"] : ["npx", "-y"];
        const r = spawnSync(
          runner[0],
          [...runner.slice(1), "create-schemic", ".", "--driver", name],
          { stdio: "inherit", cwd: process.cwd() },
        );
        process.exit(r.status ?? 1);
      }
      const { created, skipped } = init(process.cwd(), getDriver(name));
      for (const f of created) console.log(`  ${style.green("+")} ${f}`);
      for (const f of skipped)
        console.log(style.dim(`  · ${f} (exists, skipped)`));
      console.log(
        created.length
          ? `\n${ok("Initialized. Edit database/schema, then run `schemic gen`.")}`
          : "\nNothing to do — already initialized.",
      );
    });
  });

kindFlags(
  dbFlags(
    program
      .command("diff")
      .description("Show pending schema changes without writing a migration"),
  ),
)
  .option("--down", "also show the rollback (down) statements")
  .option("--live", "diff against the live database instead of the snapshot")
  .option("--ts", "show the change as TypeScript schema instead of DDL")
  .option("--watch", "re-run on schema changes")
  .option("--full", "show the full schema SQL, not just the changed parts")
  .option(
    "-p, --patch",
    "output a unified diff (e.g. to pipe to a diff viewer)",
  )
  .option(
    "--pager [cmd]",
    "page through your git diff viewer (or <cmd>); off by default",
  )
  .option(
    "--inline",
    "render changes as an inline word-diff instead of separate -/+ lines",
  )
  .option("--json", "output the diff as JSON")
  .option(
    "--driver <name>",
    "target database driver (default from config, or 'surreal')",
  )
  .action(
    (
      opts: CommonOpts &
        FilterOpts & {
          down?: boolean;
          live?: boolean;
          ts?: boolean;
          watch?: boolean;
          full?: boolean;
          patch?: boolean;
          pager?: string | boolean;
          inline?: boolean;
          json?: boolean;
          driver?: string;
        },
    ) => {
      run(async () => {
        const config = await resolveOne(opts);
        const driverName = opts.driver ?? config.driver ?? "surrealdb";
        await ensureDriver(driverName);
        const driver = getDriver(driverName);
        // A driver without the rich live/snapshot diff capability routes through the portable-IR
        // diff path (introspect + structural compare); the snapshot/`--ts`/`--live` pipeline below
        // needs it. The CLI gates on the CAPABILITY, never on the driver name.
        const diffLive = driver.diffLive;
        if (!diffLive) {
          await portableDiff(config, driverName, { json: opts.json });
          return;
        }
        const filter = parseFilter(opts);
        // External pager only when explicitly requested via `--pager` (the default renders inline).
        // `--pager <cmd>` uses that command; bare `--pager` resolves the user's git diff viewer
        // (`pager.diff`/`core.pager`/$GIT_PAGER/$PAGER). `--patch` forces the unified-diff format
        // (to the pager, or to stdout when piped). Paging is incompatible with `--watch`.
        const pager =
          opts.watch || opts.pager === undefined || opts.pager === false
            ? undefined
            : typeof opts.pager === "string"
              ? opts.pager
              : resolvePager();
        const emit = async (diff: Diff, pending?: number) => {
          if (opts.json) {
            console.log(
              JSON.stringify({ up: diff.up, down: diff.down, pending }),
            );
          } else if ((opts.patch || pager) && !isEmptyDiff(diff)) {
            const patch = formatPatch(diff);
            if (pager) await pipeThroughPager(pager, patch);
            else process.stdout.write(patch);
            const summary = diffSummary(driver.registry, diff, opts, pending);
            if (summary) console.log(summary);
          } else {
            reportDiff(driver.registry, diff, opts, pending);
          }
        };
        // Reuse one connection across watch runs for --live; otherwise connect per run.
        const persistent =
          opts.watch && opts.live
            ? await driver.connect(config, opts)
            : undefined;
        const once = async () => {
          // TypeScript view: render both sides PER FILE (matching `pull`'s layout) and diff each.
          if (opts.ts) {
            // Map each object to its source file (where it lives in the schema, else its kind folder
            // — the driver names the folder per kind via the registry's display metadata).
            const loc = await existingTables(config.schemaPath);
            const fileFor = (kind: string, name: string): string => {
              const abs = kind === "table" ? loc.get(name) : undefined;
              return abs
                ? relative(config.root, abs)
                : relative(
                    config.root,
                    join(
                      config.schemaPath,
                      driver.registry.display(kind).folder,
                      `${name}.ts`,
                    ),
                  );
            };
            // Single-file layout → one combined module key; directory layout → one file per object.
            const single = config.schemaIsFile
              ? relative(config.root, config.schemaPath)
              : undefined;

            // cur = the baseline (live DB or snapshot) rendered to source, des = the declared schema.
            const showTsDiff = async (
              cur: Map<string, string>,
              des: Map<string, string>,
              matchMsg: string,
            ) => {
              if (opts.json) {
                console.log(
                  JSON.stringify({
                    current: Object.fromEntries(cur),
                    desired: Object.fromEntries(des),
                  }),
                );
                return;
              }
              const files = [...new Set([...cur.keys(), ...des.keys()])].sort();
              const changed = files.filter(
                (f) => (cur.get(f) ?? "") !== (des.get(f) ?? ""),
              );
              if (!changed.length) {
                console.log(ok(matchMsg));
              } else if (pager || opts.patch) {
                // A git-style unified patch, one section per changed file.
                const patch = changed
                  .map((f) =>
                    unifiedDiff(cur.get(f) ?? "", des.get(f) ?? "", f),
                  )
                  .join("");
                if (pager) await pipeThroughPager(pager, patch);
                else process.stdout.write(patch);
              } else {
                // Colored, one git-style section per changed file (path header + line diff).
                console.log(
                  changed
                    .map(
                      (f) =>
                        `${style.bold(f)}\n${lineDiff(cur.get(f) ?? "", des.get(f) ?? "")}`,
                    )
                    .join("\n\n"),
                );
              }
            };

            if (opts.live) {
              if (!driver.diffTsLive)
                throw new Error(
                  `the "${driverName}" driver does not support \`diff --ts --live\`.`,
                );
              const db = persistent ?? (await driver.connect(config, opts));
              try {
                const { current, desired } = await driver.diffTsLive(
                  db,
                  config,
                  filter,
                  fileFor,
                  single,
                );
                await showTsDiff(
                  current,
                  desired,
                  "Schema matches the live database.",
                );
              } finally {
                if (!persistent) await driver.close(db);
              }
            } else {
              if (!driver.renderSchema)
                throw new Error(
                  `the "${driverName}" driver does not support \`diff --ts\`.`,
                );
              // Offline: render the snapshot's recorded schema and the declared schema to source,
              // then diff per file.
              const prev = readSnapshot(config.metaDir);
              const prevObjects = snapshotObjects(prev.schema);
              const { tables, defs } = await loadDefs(config.schemaPath);
              const desiredObjects = lowerSchema(
                driver.registry,
                driver.explode(tables, defs),
              );
              // No snapshot? Render against an empty current side — the whole schema shows as added
              // TS, the same as plain `diff` does against an empty snapshot.
              await showTsDiff(
                driver.renderSchema(prevObjects, filter, fileFor, single),
                driver.renderSchema(desiredObjects, filter, fileFor, single),
                prevObjects.length
                  ? "Schema matches the snapshot."
                  : "No schema to render.",
              );
            }
            return;
          }
          if (opts.live) {
            const db = persistent ?? (await driver.connect(config, opts));
            try {
              const diff = await diffLive(db, config, filter);
              const pending = (await status(db, config)).filter(
                (r) => !r.applied,
              ).length;
              await emit(diff, pending);
            } finally {
              if (!persistent) await driver.close(db);
            }
          } else {
            await emit((await planMigration(config, filter)).diff);
          }
        };
        if (!opts.watch) return once();
        await watchLoop(
          config,
          once,
          persistent ? () => driver.close(persistent) : undefined,
        );
      });
    },
  );

// `gen` is the primary command; `generate` is a hidden, undocumented alias (a separate hidden
// command so help shows only `gen`, not `gen|generate`). Both share one action.
const genAction = (
  name: string | undefined,
  opts: CommonOpts &
    FilterOpts & { yes?: boolean; baseline?: boolean; force?: boolean },
) => {
  run(async () => {
    const config = await resolveOne(opts);
    const filter = parseFilter(opts);
    // A baseline regenerates the WHOLE schema from an empty snapshot; existing migrations would
    // clash (they already created those objects), so a baseline must REPLACE them. With --force (or
    // an interactive yes) we squash them into one fresh baseline; otherwise stop with the exact
    // command to run.
    let squashed: string[] | null = null;
    if (opts.baseline) {
      const existing = listMigrations(
        config.migrationsDir,
        activeDriver(config).migrations?.extension ?? ".surql",
      );
      if (existing.length) {
        const migDir = relative(config.root, config.migrationsDir);
        const proceed =
          opts.force ||
          (await confirmPrompt(
            `Replace ${plural(existing.length, "migration")} in ${migDir} with a single baseline?`,
          ));
        if (!proceed) {
          throw new Error(
            `${plural(existing.length, "migration")} already exist in ${migDir} — a baseline would re-define objects they already created.\n  Re-run \`schemic gen --baseline --force\` to replace them with one fresh baseline.`,
          );
        }
        squashed = clearMigrationFiles(config);
      }
    }
    const plan = await planMigration(config, filter, {
      baseline: opts.baseline,
    });
    if (isEmptyDiff(plan.diff)) {
      console.log(ok("No schema changes — nothing to generate."));
      return;
    }
    const kinds = summarizeKinds(
      activeDriver(config).registry,
      plan.diff.items ?? [],
    );
    // The change summary gives the scope you're naming; `schemic diff` is the +/- comparison view.
    console.log(
      `${plural(plan.diff.up.length, "change")}${kinds ? ` — ${kinds}` : ""}.`,
    );
    const title =
      name ??
      (opts.baseline ? "baseline" : opts.yes ? undefined : await promptTitle());
    const prepared = prepareMigration(config, plan, title);
    if (!prepared) {
      console.log(ok("No schema changes — nothing to generate."));
      return;
    }
    const res = commitMigration(config, prepared);
    // `gen` shows the migration it WROTE (the rendered DDL), not a diff — so you review the actual
    // statements that will replay. Indented under the filename; counts close it out.
    const body = prepared.content
      .replace(/\n+$/, "")
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n");
    console.log(
      `\n${ok(res.file ?? "migration written")}\n\n${style.dim(body)}\n\n  ${style.dim(`(+${res.up} up / ${res.down} down)`)}`,
    );
    // After a squash, reconcile the live DB's migration history (best-effort): when the DB already
    // matches the schema, record the baseline as applied so its DDL isn't re-run and `schemic status`
    // stays clean. Unreachable / drifted → leave it pending and say so.
    if (squashed) {
      console.log(
        style.dim(`  replaced ${plural(squashed.length, "migration")}.`),
      );
      try {
        const driver = activeDriver(config);
        const diffLive = driver.diffLive;
        if (!diffLive)
          throw new Error(
            `the "${config.driver ?? "surrealdb"}" driver does not support live reconcile`,
          );
        const db = await driver.connect(config, opts);
        try {
          const drift = !isEmptyDiff(await diffLive(db, config, filter));
          const state = await reconcileBaseline(db, config, prepared, drift);
          console.log(
            style.dim(
              state === "applied"
                ? "  database matched the schema — baseline recorded as applied."
                : "  database differs from the schema — baseline left pending; run `schemic migrate`.",
            ),
          );
        } finally {
          await driver.close(db);
        }
      } catch (e) {
        console.log(
          style.dim(
            `  database not reconciled (${errMsg(e)}) — baseline is pending; run \`schemic migrate\` to apply it.`,
          ),
        );
      }
    }
  });
};
const addGenCommand = (cmd: Command): void => {
  kindFlags(dbFlags(cmd))
    .option("-y, --yes", "use the given/default name without prompting")
    .option(
      "--baseline",
      "regenerate one fresh baseline from an empty snapshot (replaces existing migrations)",
    )
    .option(
      "--force",
      "with --baseline, replace existing migrations without confirmation",
    )
    .action(genAction);
};
addGenCommand(
  program
    .command("gen [name]")
    .description("Diff schemas, preview the migration script, and write it"),
);
addGenCommand(program.command("generate [name]", { hidden: true }));

// `snapshot` groups operations on the migration snapshot (the state `schemic gen`/`schemic diff` compare
// against). `reset` clears it so the next `schemic gen` baselines the full schema.
const snapshot = program
  .command("snapshot")
  .description(
    "Manage the migration snapshot (what `schemic gen`/`schemic diff` compare against)",
  );
configFlag(
  snapshot
    .command("reset")
    .description(
      "Clear the snapshot — the next `schemic gen` baselines the full schema",
    ),
).action((opts: CommonOpts) => {
  run(async () => {
    const config = await resolveOne(opts);
    writeSnapshot(config.metaDir, EMPTY_STORED);
    console.log(ok("Snapshot cleared."));
    const existing = listMigrations(
      config.migrationsDir,
      activeDriver(config).migrations?.extension ?? ".surql",
    );
    if (existing.length) {
      console.log(
        style.dim(
          `  ${plural(existing.length, "migration")} still on disk — run \`schemic gen --baseline --force\` to replace them with one fresh baseline. (A plain \`schemic gen\` would add a baseline alongside them.)`,
        ),
      );
    } else {
      console.log(
        style.dim("  The next `schemic gen` will baseline the full schema."),
      );
    }
  });
});

dbFlags(
  program
    .command("migrate [count]")
    .alias("up")
    .description(
      "Apply pending migrations (all, the next N, or up to --to <tag>)",
    )
    .option("--to <tag>", "apply up to and including this migration"),
).action((count: string | undefined, opts: CommonOpts & { to?: string }) => {
  run(() =>
    withDb(opts, async (db, config) => {
      const n =
        count === undefined
          ? undefined
          : Math.max(1, Number.parseInt(count, 10) || 1);
      const { applied } = await migrate(db, config, { count: n, to: opts.to });
      if (!applied.length) {
        console.log(ok("Up to date — no pending migrations."));
        return;
      }
      for (const e of applied) console.log(`  ${style.green("↑")} ${e.tag}`);
      console.log(`\n${ok(`Applied ${plural(applied.length, "migration")}.`)}`);
    }),
  );
});

dbFlags(
  program.command("status").description("Show applied vs pending migrations"),
)
  .option("--json", "output the status as JSON")
  .action((opts: CommonOpts & { json?: boolean }) => {
    run(() =>
      withDb(opts, async (db, config) => {
        const rows = await status(db, config);
        if (opts.json) {
          console.log(JSON.stringify(rows));
          return;
        }
        if (!rows.length) {
          console.log("No migrations yet. Run `schemic gen`.");
          return;
        }
        for (const r of rows) {
          if (r.missing) {
            console.log(
              `  ${style.yellow("⚠ missing")}  ${r.tag} ${style.dim("(applied in the DB, file deleted)")}`,
            );
          } else if (r.drift) {
            console.log(
              `  ${style.yellow("⚠ drift")}    ${r.tag} ${style.dim("(file changed after apply)")}`,
            );
          } else if (r.applied) {
            console.log(`  ${style.green("✓ applied")}  ${r.tag}`);
          } else {
            console.log(style.dim(`  · pending  ${r.tag}`));
          }
        }
        const pending = rows.filter((r) => !r.applied).length;
        const drifted = rows.filter((r) => r.drift).length;
        const missing = rows.filter((r) => r.missing).length;
        const parts = [plural(rows.length, "migration"), `${pending} pending`];
        if (drifted) parts.push(`${drifted} drifted`);
        if (missing) parts.push(`${missing} missing`);
        console.log(`\n${style.dim(`${parts.join(", ")}.`)}`);
        if (missing) {
          console.log(
            style.dim(
              "  Missing migrations were applied but their files are gone (e.g. after removing migrations or `snapshot reset`).",
            ),
          );
        }
      }),
    );
  });

dbFlags(
  program
    .command("check")
    .description(
      "Validate schemas, then replay migrations to confirm they reproduce the schema",
    )
    .option(
      "--schema",
      "validate the schema only — skip the migration replay (no database)",
    ),
).action((opts: CommonOpts & { schema?: boolean }) => {
  run(async () => {
    const config = await resolveOne(opts);
    const driver = activeDriver(config);

    // 1. Static validation (no connection): no duplicate tables, schemas parse.
    const dups = await duplicateTables(config.schemaPath);
    if (dups.size) {
      const lines = formatDuplicates(dups, config.root).map((l) => `  ${l}`);
      throw new Error(`${duplicateHeader(dups.size)}\n${lines.join("\n")}`);
    }
    const { tables, defs } = await loadDefs(config.schemaPath);
    const kinds = summarizeKinds(
      driver.registry,
      lowerSchema(driver.registry, driver.explode(tables, defs)),
    );
    console.log(ok(`Schemas valid${kinds ? ` — ${kinds}` : " (no objects)"}.`));
    if (opts.schema) return;

    // 2. Deep check: replay every migration into a throwaway engine and confirm the result matches
    //    the schema. The driver owns the replay (engine selection + apply); it NEVER touches the
    //    real database. A driver without the capability can only `check --schema`.
    if (!driver.checkReplay) {
      throw new Error(
        `the "${config.driver ?? "surrealdb"}" driver does not support migration replay — run \`schemic check --schema\` to validate the schema only.`,
      );
    }
    const diff = await driver.checkReplay(config, opts, parseFilter({}), (m) =>
      console.log(style.dim(m)),
    );
    if (isEmptyDiff(diff)) {
      console.log(ok("Migrations reproduce the schema."));
      return;
    }
    console.log(
      `\n${fail("Drift — migrations do not reproduce the schema:")}\n`,
    );
    console.log(formatDiff(diff, {}));
    console.log(
      `\n${style.dim(`${summarizeKinds(driver.registry, diff.items ?? [])} differ. \`schemic gen\` writes a migration to reconcile.`)}`,
    );
    process.exitCode = 1;
  });
});

dbFlags(
  program
    .command("doctor")
    .description("Print resolved config and test the connection"),
).action((opts: CommonOpts) => {
  run(async () => {
    const config = await resolveOne(opts);
    const row = (k: string, v: string) =>
      console.log(style.dim(`  ${k.padEnd(11)} ${v}`));
    console.log(style.bold("Project"));
    row("root", config.root);
    row("connection", `${config.connection} (${config.driver})`);
    row("migrations", relative(config.root, config.migrationsDir));
    console.log(style.bold("\nSchema"));
    row(
      "source",
      `${relative(config.root, config.schemaPath)} (${config.schemaIsFile ? "file" : "directory"})`,
    );
    try {
      const defs = await loadSchemas(config.schemaPath);
      row(
        "tables",
        defs.length
          ? `${plural(defs.length, "table")} — ${defs.map((t) => t.name).join(", ")}`
          : "(none found)",
      );
      const dups = await duplicateTables(config.schemaPath);
      if (dups.size) {
        console.log(`  ${fail(duplicateHeader(dups.size))}`);
        for (const line of formatDuplicates(dups, config.root))
          console.log(style.dim(`    ${line}`));
        process.exitCode = 1;
      }
    } catch (e) {
      console.log(`  ${fail(e instanceof Error ? e.message : String(e))}`);
    }
    // The connection params are driver-specific + opaque to the CLI — print them generically,
    // redacting anything secret-looking (password/secret/token/key). The driver names the params.
    console.log(style.bold("\nConnection"));
    const secret = /pass|secret|token|key/i;
    const params = Object.entries(config.params);
    if (params.length) {
      for (const [k, v] of params)
        row(k, secret.test(k) ? "***" : String(v ?? ""));
    } else {
      row("params", "(none)");
    }
    console.log(style.bold("\nVersions"));
    row("@schemic/core", program.version() ?? "?");
    row("node", process.version);
    console.log(style.bold("\nStatus"));
    try {
      const driver = activeDriver(config);
      const db = await driver.connect(config, opts);
      const info = driver.serverInfo
        ? await driver.serverInfo(db)
        : (config.driver ?? "surrealdb");
      console.log(`  ${ok(`connected — ${info}`)}`);
      await driver.close(db);
    } catch (e) {
      console.log(`  ${fail(e instanceof Error ? e.message : String(e))}`);
      process.exitCode = 1;
    }
  });
});

dbFlags(
  program
    .command("rollback [count]")
    .alias("down")
    .description("Roll back applied migrations (last N, or back to --to <tag>)")
    .option("--to <tag>", "roll back everything applied after this migration"),
).action((count: string | undefined, opts: CommonOpts & { to?: string }) => {
  run(() =>
    withDb(opts, async (db, config) => {
      const reverted = await rollback(db, config, {
        to: opts.to,
        count:
          opts.to || count === undefined
            ? undefined
            : Math.max(1, Number.parseInt(count, 10) || 1),
      });
      if (!reverted.length) {
        console.log(ok("Nothing to roll back."));
        return;
      }
      for (const e of reverted) console.log(`  ${style.yellow("↓")} ${e.tag}`);
      console.log(
        `\n${ok(`Rolled back ${plural(reverted.length, "migration")}.`)}`,
      );
    }),
  );
});

configFlag(
  program
    .command("new <kind> <name>")
    .description(
      "Scaffold a new schema file for an entity, e.g. `sc new table user`",
    ),
).action((kind: string, name: string, opts: CommonOpts) => {
  run(async () => {
    const config = await resolveOne(opts);
    const driver = activeDriver(config);
    if (!driver.scaffoldEntity)
      throw new Error(`the "${config.driver}" driver can't scaffold entities.`);
    if (config.schemaIsFile)
      throw new Error(
        "`schemic new` needs a schema directory — your schema is a single file.",
      );
    // The driver authors the file (throws for a kind it can't); it lands under the kind's folder.
    const content = driver.scaffoldEntity(kind, name);
    const target = join(
      config.schemaPath,
      driver.registry.display(kind).folder,
      `${name}.ts`,
    );
    if (existsSync(target))
      throw new Error(`${relative(config.root, target)} already exists.`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    console.log(
      `${ok(relative(config.root, target))}  ${style.dim("— author its fields, then `schemic gen`")}`,
    );
  });
});

dbFlags(
  program.command("unlock").description("Clear a stale migration lock"),
).action((opts: CommonOpts) => {
  run(() =>
    withDb(opts, async (db, config) => {
      await unlock(db, config);
      console.log(ok("Migration lock cleared."));
    }),
  );
});

kindFlags(
  dbFlags(
    program
      .command("push")
      .alias("sync")
      .description(
        "Reconcile the live database with your schema (no migration files)",
      )
      .option("--no-prune", "keep objects that were removed from the schema")
      .option("--dry-run", "preview the changes without applying them")
      .option("--watch", "re-sync on schema changes"),
  ),
).action(
  (
    opts: CommonOpts &
      FilterOpts & { prune?: boolean; dryRun?: boolean; watch?: boolean },
  ) => {
    run(async () => {
      const config = await resolveOne(opts);
      const driver = activeDriver(config);
      const filter = parseFilter(opts);
      const diffLive = driver.diffLive;
      const syncPlan = driver.syncPlan;
      if (!diffLive || !syncPlan)
        throw new Error(
          `the "${config.driver ?? "surrealdb"}" driver does not support \`push\`.`,
        );
      const once = async (db: unknown) => {
        const diff = await diffLive(db, config, filter);
        const stmts = syncPlan(diff, opts.prune);
        if (!stmts.length) {
          console.log(ok("Database already matches the schema."));
          return;
        }
        // With --no-prune, drops are kept in the DB — hide the remove items from the preview too.
        const items = (diff.items ?? []).filter(
          (it: DiffItem) => opts.prune !== false || it.op !== "remove",
        );
        console.log(formatItems(items));
        const kinds = summarizeKinds(driver.registry, items);
        if (opts.dryRun) {
          console.log(
            `\n${style.dim(`${plural(stmts.length, "change")}${kinds ? ` — ${kinds}` : ""} — run \`schemic push\` to apply.`)}`,
          );
          return;
        }
        await driver.apply(db, stmts);
        const pruned =
          opts.prune === false
            ? 0
            : (diff.items ?? []).filter((it) => it.op === "remove").length;
        console.log(
          `\n${ok(`synced ${plural(stmts.length - pruned, "object")}${pruned ? `, pruned ${pruned}` : ""}${kinds ? ` (${kinds})` : ""}.`)}`,
        );
      };
      if (!opts.watch) {
        await withDb(opts, (db) => once(db));
        return;
      }
      const db = await driver.connect(config, opts);
      await watchLoop(
        config,
        () => once(db),
        () => driver.close(db),
      );
    });
  },
);

dbFlags(
  program
    .command("seed [name]")
    .description(
      "Run the project's seed(s): a named seed, --all (every seed), or (no arg) index.ts / every seed",
    ),
  // NOTE: `--all` comes from dbFlags (every connection) and doubles as "every seed" here — do NOT add
  // a second `--all` option (commander throws a conflicting-flag error at construction).
).action((name: string | undefined, opts: CommonOpts & { all?: boolean }) => {
  run(() =>
    withDb(opts, async (db, config) => {
      await seed(db, config, { name, all: opts.all });
      console.log(ok("Seed complete."));
    }),
  );
});

/** Print the per-file create/update diffs of a pull plan (unchanged files are omitted). */
function printPullPlan(plan: PullPlan): void {
  for (const f of plan.files) {
    if (f.action === "unchanged") continue;
    console.log(`\n${actionLabel(f.action)} ${style.bold(f.rel)}`);
    if (f.action === "delete") {
      console.log(
        style.dim(
          `  whole file removed — ${f.localOnly.objects.join(", ")} not in the database`,
        ),
      );
      continue;
    }
    console.log(
      lineDiff(f.before, f.after)
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n"),
    );
  }
}

/** List the local-only fields/objects a mirror pull would drop. */
function printLocalOnly(files: PullFilePlan[]): void {
  console.log(`\n${style.yellow("! local-only schema, not in the database:")}`);
  for (const f of files) {
    for (const fld of f.localOnly.fields)
      console.log(
        style.dim(`    ${f.rel}: ${fld.exportName} → ${fld.fields.join(", ")}`),
      );
    for (const obj of f.localOnly.objects)
      console.log(style.dim(`    ${f.rel}: ${obj} (whole definition)`));
  }
  console.log(style.dim("  keep with --merge, or drop with --discard."));
}

/**
 * One `pull` evaluation pass against an OPEN connection: plan, then preview or (with `--write`) apply.
 * Returns true if it printed a plan (changes or at-risk local-only), false if the files already match the
 * DB. Shared by the one-shot command and the `--watch` poll loop; in `watch` mode the at-risk guard warns
 * instead of throwing, so a single risky tick doesn't kill the loop.
 */
async function pullPass(
  db: unknown,
  config: ResolvedConfig,
  opts: FilterOpts & { write?: boolean; merge?: boolean; discard?: boolean },
  watch: boolean,
): Promise<boolean> {
  const driver = activeDriver(config);
  if (!driver.planPull)
    throw new Error(
      `the "${config.driver ?? "surrealdb"}" driver does not support \`pull\`.`,
    );
  const plan = await driver.planPull(db, config, {
    filter: parseFilter(opts),
    keepLocal: opts.merge,
  });
  const changed = plan.files.filter((f) => f.action !== "unchanged");
  // Local-only content is only "at risk" when we're not keeping it (--merge keeps it).
  const atRisk = opts.merge
    ? []
    : plan.files.filter(
        (f) => f.localOnly.fields.length || f.localOnly.objects.length,
      );
  if (!changed.length && !atRisk.length) return false;

  printPullPlan(plan);
  if (!opts.write) {
    if (changed.length)
      console.log(
        `\n${style.dim(`${plural(changed.length, "file")} would change — run \`schemic pull --write\` to apply.`)}`,
      );
    if (atRisk.length) printLocalOnly(atRisk);
    return true;
  }
  // Don't silently destroy local-only schema (the git "commit or stash" guard).
  if (atRisk.length && !opts.discard) {
    printLocalOnly(atRisk);
    const msg =
      "pull would overwrite local-only schema — re-run with --merge to keep it or --discard to mirror the database.";
    if (!watch) throw new Error(msg);
    console.error(fail(msg)); // watch: warn but keep polling
    return true;
  }
  const written = applyPull(plan);
  // Baseline: sync the snapshot + record the pulled state as already-applied, so the schema matches the
  // DB and `schemic diff` doesn't report the freshly-pulled objects as pending.
  const base = await baseline(db, config);
  const removed = plan.files.filter((f) => f.action === "delete").length;
  // Local-only entities mixed with other code: surfaced but not safely deletable.
  const kept = opts.merge
    ? []
    : plan.files.filter(
        (f) => f.action === "unchanged" && f.localOnly.objects.length,
      );
  console.log(
    `\n${ok(`Pulled ${plural(written.length, "file")} from the database${removed ? ` (${removed} removed)` : ""}.`)}`,
  );
  if (base.created)
    console.log(
      style.dim(
        `  baseline ${base.tag} recorded (snapshot synced, marked applied).`,
      ),
    );
  if (kept.length)
    console.log(
      style.dim(
        `  ${plural(kept.length, "file")} with local-only entities mixed with other code left in place — remove those entities by hand.`,
      ),
    );
  return true;
}

/**
 * `pull --watch`: poll the LIVE DB (NOT the files — pull writes files, so an fsWatch would self-trigger).
 * Reuse one connection; every `intervalMs` re-plan + preview/apply via {@link pullPass}; an unchanged tick
 * shows a dim, in-place heartbeat. Ctrl-C closes the connection and exits. Never resolves.
 */
function pullPollLoop(
  config: ResolvedConfig,
  db: unknown,
  intervalMs: number,
  opts: FilterOpts & { write?: boolean; merge?: boolean; discard?: boolean },
): Promise<never> {
  return new Promise<never>(() => {
    const driver = activeDriver(config);
    console.log(
      style.dim(
        `Polling ${config.connection ?? "the database"} every ${intervalMs / 1000}s — ctrl-c to stop.`,
      ),
    );
    let stopped = false;
    const stop = () => {
      stopped = true;
      Promise.resolve(driver.close(db)).finally(() => process.exit(0));
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const tick = async () => {
      if (stopped) return;
      try {
        const printed = await pullPass(db, config, opts, true);
        if (!printed)
          process.stdout.write(
            style.dim(`\r· ${new Date().toLocaleTimeString()}  in sync   `),
          );
      } catch (err) {
        console.error(`\n${fail(errMsg(err))}`);
      }
      if (!stopped) setTimeout(() => void tick(), intervalMs);
    };
    void tick();
  });
}

kindFlags(
  dbFlags(
    program
      .command("pull")
      .description("Generate/update Zod schema files from the live database")
      .option("--write", "apply the changes (default: preview only)")
      .option(
        "--merge",
        "keep local-only fields/objects (default: mirror the DB)",
      )
      .option(
        "--discard",
        "drop local-only fields/objects to mirror the DB exactly",
      )
      .option("--watch", "poll the live DB and re-pull as it changes")
      .option(
        "--interval <seconds>",
        "poll interval in seconds for --watch (default: 2)",
      ),
  ),
).action(
  (
    opts: CommonOpts &
      FilterOpts & {
        write?: boolean;
        merge?: boolean;
        discard?: boolean;
        watch?: boolean;
        interval?: string;
      },
  ) => {
    run(async () => {
      // --watch polls the DB on ONE reused connection (a single target). Otherwise the normal one-shot
      // pass, fanned across targets by withDb.
      if (opts.watch) {
        const config = await resolveOne(opts);
        const driver = activeDriver(config);
        if (!driver.planPull)
          throw new Error(
            `the "${config.driver ?? "surrealdb"}" driver does not support \`pull\`.`,
          );
        const intervalMs = Math.max(500, (Number(opts.interval) || 2) * 1000);
        const db = await driver.connect(config, opts);
        await pullPollLoop(config, db, intervalMs, opts);
        return;
      }
      await withDb(opts, async (db, config) => {
        if (!(await pullPass(db, config, opts, false)))
          console.log(ok("Schema files already match the database."));
      });
    });
  },
);

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}
program.parse();
