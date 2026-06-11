import { watch as fsWatch } from "node:fs";
import { relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { Command, Help, Option } from "commander";
import type { Surreal } from "surrealdb";
import {
  type ConnectionOverrides,
  connect,
  loadConfig,
  type ResolvedConfig,
} from "./config";
import {
  buildSnapshot,
  type Diff,
  type DiffItem,
  formatDiff,
  formatItems,
  formatPatch,
  isEmptyDiff,
  summarizeKinds,
} from "./diff";
import { spawnEphemeralServer, surrealBinaryAvailable } from "./engine";
import { type FilterOpts, kindFlags, parseFilter } from "./filter";
import { init } from "./init";
import {
  applyStatements,
  diffAgainstDb,
  syncPlan,
  verifyMigrations,
} from "./introspect";
import {
  baseline,
  commitMigration,
  migrate,
  newMigration,
  planMigration,
  prepareMigration,
  rollback,
  seed,
  status,
  unlock,
} from "./migrate";
import { pipeThroughPager, resolvePager } from "./pager";
import { pull } from "./pull";
import { duplicateTables, loadDefs, loadSchemas } from "./schema";
import { fail, ok, plural, style } from "./style";

interface CommonOpts extends ConnectionOverrides {
  config?: string;
}

/** Load config, connect, run, and always close the handle. */
async function withDb(
  opts: CommonOpts,
  fn: (db: Surreal, config: ResolvedConfig) => Promise<void>,
): Promise<void> {
  const config = await loadConfig({ config: opts.config });
  const db = await connect(config, opts);
  try {
    await fn(db, config);
  } finally {
    await db.close();
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

/** The short dimmed summary under a diff (per-kind counts + optional pending count). */
function diffSummary(
  diff: Diff,
  opts: { live?: boolean },
  pending?: number,
): string {
  const summary: string[] = [];
  if (!isEmptyDiff(diff)) {
    const kinds = summarizeKinds(diff.up);
    summary.push(
      `${plural(diff.up.length, "change")} ${opts.live ? "vs the live database" : "pending"}${kinds ? ` — ${kinds}` : ""}.`,
    );
  }
  if (pending !== undefined)
    summary.push(`${plural(pending, "migration")} pending.`);
  return summary.length ? `\n${style.dim(summary.join("\n"))}` : "";
}

/** Print a diff (inline word-diff) plus its summary. */
function reportDiff(
  diff: Diff,
  opts: { down?: boolean; live?: boolean; full?: boolean; inline?: boolean },
  pending?: number,
): void {
  console.log(
    formatDiff(diff, { down: opts.down, full: opts.full, inline: opts.inline }),
  );
  const summary = diffSummary(diff, opts, pending);
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
      style.dim(`Watching ${config.schema} for changes — ctrl-c to stop.`),
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
  cmd.option("-c, --config <path>", "path to surreal-zod.config.ts");

const dbFlags = (cmd: Command): Command =>
  configFlag(cmd)
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
  .name("surreal-zod")
  .description(
    "Author SurrealDB schemas with Zod — DDL generation + migrations",
  )
  .version("0.1.0-alpha.0")
  .showHelpAfterError("(run `surreal-zod --help` for usage)")
  .addHelpText(
    "after",
    `
Examples:
  $ sz init                 scaffold database/ (schemas + migrations) + config
  $ sz gen add_users        create a migration from schema changes
  $ sz migrate              apply pending migrations
  $ sz sync --watch         keep the database in sync while you edit
  $ sz diff --live          show how the schema differs from the live database
`,
  );

// Collapse negatable boolean flags to a single `--[no-]flag` line in help (instead of listing the
// `--no-flag` form separately). Set before any subcommand is added so they inherit it.
program.configureHelp({
  optionTerm(option) {
    const term = Help.prototype.optionTerm.call(this, option);
    return option.negate ? term.replace("--no-", "--[no-]") : term;
  },
});

program
  .command("init")
  .description("Scaffold database/ (schemas + migrations) and a config file")
  .action(() => {
    const { created, skipped } = init(process.cwd());
    for (const f of created) console.log(`  ${style.green("+")} ${f}`);
    for (const f of skipped)
      console.log(style.dim(`  · ${f} (exists, skipped)`));
    console.log(
      created.length
        ? `\n${ok("Initialized. Edit database/schemas, then run `sz gen`.")}`
        : "\nNothing to do — already initialized.",
    );
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
  .action(
    (
      opts: CommonOpts &
        FilterOpts & {
          down?: boolean;
          live?: boolean;
          watch?: boolean;
          full?: boolean;
          patch?: boolean;
          pager?: string | boolean;
          inline?: boolean;
          json?: boolean;
        },
    ) => {
      run(async () => {
        const config = await loadConfig({ config: opts.config });
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
            const summary = diffSummary(diff, opts, pending);
            if (summary) console.log(summary);
          } else {
            reportDiff(diff, opts, pending);
          }
        };
        // Reuse one connection across watch runs for --live; otherwise connect per run.
        const persistent =
          opts.watch && opts.live ? await connect(config, opts) : undefined;
        const once = async () => {
          if (opts.live) {
            const db = persistent ?? (await connect(config, opts));
            try {
              const diff = await diffAgainstDb(db, config, filter);
              const pending = (await status(db, config)).filter(
                (r) => !r.applied,
              ).length;
              await emit(diff, pending);
            } finally {
              if (!persistent) await db.close();
            }
          } else {
            await emit((await planMigration(config, filter)).diff);
          }
        };
        if (!opts.watch) return once();
        await watchLoop(
          config,
          once,
          persistent ? () => persistent.close() : undefined,
        );
      });
    },
  );

// `gen` is the primary command; `generate` is a hidden, undocumented alias (a separate hidden
// command so help shows only `gen`, not `gen|generate`). Both share one action.
const genAction = (
  name: string | undefined,
  opts: CommonOpts & FilterOpts & { yes?: boolean },
) => {
  run(async () => {
    const config = await loadConfig({ config: opts.config });
    const plan = await planMigration(config, parseFilter(opts));
    if (isEmptyDiff(plan.diff)) {
      console.log(ok("No schema changes — nothing to generate."));
      return;
    }
    const kinds = summarizeKinds(plan.diff.up);
    console.log(
      `${plural(plan.diff.up.length, "change")} to migrate${kinds ? ` — ${kinds}` : ""}.`,
    );
    const title = name ?? (opts.yes ? undefined : await promptTitle());
    const prepared = prepareMigration(config, plan, title);
    if (!prepared) {
      console.log(ok("No schema changes — nothing to generate."));
      return;
    }
    // Show the actual migration script that will be written, then commit it.
    console.log(`\n${prepared.content}`);
    const res = commitMigration(config, prepared);
    console.log(
      `${ok(res.file ?? "migration written")}  ${style.dim(`(+${res.up} up / ${res.down} down)`)}`,
    );
  });
};
const addGenCommand = (cmd: Command): void => {
  kindFlags(configFlag(cmd))
    .option("-y, --yes", "use the given/default name without prompting")
    .action(genAction);
};
addGenCommand(
  program
    .command("gen [name]")
    .description("Diff schemas, preview the migration script, and write it"),
);
addGenCommand(program.command("generate [name]", { hidden: true }));

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
          console.log("No migrations yet. Run `sz gen`.");
          return;
        }
        for (const r of rows) {
          if (r.drift) {
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
        console.log(
          `\n${style.dim(`${plural(rows.length, "migration")}, ${pending} pending${drifted ? `, ${drifted} drifted` : ""}.`)}`,
        );
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
    const config = await loadConfig({ config: opts.config });

    // 1. Static validation (no connection): no duplicate tables, schemas parse.
    const dups = await duplicateTables(config.schemaPath);
    if (dups.size) {
      const lines = formatDuplicates(dups, config.root).map((l) => `  ${l}`);
      throw new Error(`${duplicateHeader(dups.size)}\n${lines.join("\n")}`);
    }
    const { tables, defs } = await loadDefs(config.schemaPath);
    const kinds = summarizeKinds(
      Object.values(buildSnapshot(tables, defs).statements).map((s) => s.ddl),
    );
    console.log(ok(`Schemas valid${kinds ? ` — ${kinds}` : " (no objects)"}.`));
    if (opts.schema) return;

    // 2. Deep check: replay every migration into throwaway scratch databases and confirm the result
    //    matches the schema. The replay NEVER reads or writes your real database. Engine selection:
    //    `auto` prefers an ephemeral in-memory server from the local `surreal` binary (your exact
    //    version, no external server); else it falls back to the `check.db`/`db` server.
    const useBinary =
      config.checkEngine === "binary" ||
      (config.checkEngine === "auto" &&
        surrealBinaryAvailable(config.checkBinary));
    if (config.checkEngine === "binary" && !useBinary) {
      throw new Error(
        'check.engine "binary" needs the `surreal` CLI on PATH (or set `check.binary`). Run `sz check --schema` to skip the replay.',
      );
    }

    let db: Surreal;
    let checkCfg: ResolvedConfig;
    let cleanup: () => Promise<void>;
    if (useBinary) {
      const server = await spawnEphemeralServer(config.checkBinary);
      checkCfg = {
        ...config,
        db: {
          url: server.url,
          namespace: "check",
          database: "check",
          username: server.username,
          password: server.password,
          authLevel: "root",
        },
      };
      db = await connect(checkCfg, {});
      cleanup = async () => {
        await db.close().catch(() => {});
        await server.stop();
      };
      console.log(
        style.dim(
          "  replaying on an ephemeral in-memory SurrealDB (local `surreal` binary) — your server is untouched",
        ),
      );
    } else {
      checkCfg = { ...config, db: config.checkDb };
      try {
        db = await connect(checkCfg, opts);
      } catch (e) {
        throw new Error(
          `${errMsg(e)}\n  (run \`sz check --schema\` to skip the replay, install the \`surreal\` CLI for an in-memory engine, or set \`check.db\` to point the replay at a scratch server)`,
        );
      }
      cleanup = async () => {
        await db.close().catch(() => {});
      };
      console.log(
        style.dim(
          `  replaying on ${config.checkDb.url} (${config.checkDb.namespace}) — isolated scratch databases; your data is untouched`,
        ),
      );
    }

    try {
      const diff = await verifyMigrations(
        db,
        checkCfg,
        parseFilter({}),
        (tag) => console.log(style.dim(`  ${tag}`)),
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
        `\n${style.dim(`${summarizeKinds(diff.up)} differ. \`sz gen\` writes a migration to reconcile.`)}`,
      );
      process.exitCode = 1;
    } finally {
      await cleanup();
    }
  });
});

dbFlags(
  program
    .command("doctor")
    .description("Print resolved config and test the connection"),
).action((opts: CommonOpts) => {
  run(async () => {
    const config = await loadConfig({ config: opts.config });
    const d = config.db;
    const row = (k: string, v: string) =>
      console.log(style.dim(`  ${k.padEnd(11)} ${v}`));
    console.log(style.bold("Project"));
    row("root", config.root);
    row("migrations", config.migrations ?? "");
    console.log(style.bold("\nSchema"));
    row(
      "source",
      `${config.schema} (${config.schemaIsFile ? "file" : "directory"})`,
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
    console.log(style.bold("\nConnection"));
    row("url", d.url);
    row("namespace", d.namespace);
    row("database", d.database);
    row(
      "auth",
      d.username ? `${d.username} (${d.authLevel ?? "root"} access)` : "(none)",
    );
    console.log(style.bold("\nVersions"));
    row("surreal-zod", program.version() ?? "?");
    row("node", process.version);
    console.log(style.bold("\nStatus"));
    try {
      const db = await connect(config, opts);
      let server = "unknown";
      try {
        server = (await db.version()).version;
      } catch {
        // server version unavailable
      }
      console.log(`  ${ok(`connected — SurrealDB ${server}`)}`);
      await db.close();
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
    .command("new <name>")
    .description("Scaffold a blank, hand-written .surql migration"),
).action((name: string, opts: CommonOpts) => {
  run(async () => {
    const config = await loadConfig({ config: opts.config });
    const { file } = newMigration(config, name);
    console.log(`${ok(file)}  ${style.dim("— edit it, then `sz migrate`")}`);
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
      .command("sync")
      .alias("push")
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
      const config = await loadConfig({ config: opts.config });
      const filter = parseFilter(opts);
      const once = async (db: Surreal) => {
        const diff = await diffAgainstDb(db, config, filter);
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
        const kinds = summarizeKinds(stmts);
        if (opts.dryRun) {
          console.log(
            `\n${style.dim(`${plural(stmts.length, "change")}${kinds ? ` — ${kinds}` : ""} — run \`sz sync\` to apply.`)}`,
          );
          return;
        }
        await applyStatements(db, stmts);
        const pruned = stmts.filter((s) => s.startsWith("REMOVE")).length;
        console.log(
          `\n${ok(`synced ${plural(stmts.length - pruned, "object")}${pruned ? `, pruned ${pruned}` : ""}${kinds ? ` (${kinds})` : ""}.`)}`,
        );
      };
      if (!opts.watch) {
        await withDb(opts, once);
        return;
      }
      const db = await connect(config, opts);
      await watchLoop(
        config,
        () => once(db),
        () => db.close(),
      );
    });
  },
);

dbFlags(
  program.command("seed").description("Run the project's seed script"),
).action((opts: CommonOpts) => {
  run(() =>
    withDb(opts, async (db, config) => {
      await seed(db, config);
      console.log(ok("Seed complete."));
    }),
  );
});

kindFlags(
  dbFlags(
    program
      .command("pull")
      .description("Generate Zod schema files from the live database")
      .option("--force", "overwrite existing schema files"),
  ),
).action((opts: CommonOpts & FilterOpts & { force?: boolean }) => {
  run(() =>
    withDb(opts, async (db, config) => {
      const { files, skipped } = await pull(db, config, {
        force: opts.force,
        filter: parseFilter(opts),
      });
      for (const f of files) console.log(`  ${style.green("+")} ${f}`);
      for (const f of skipped)
        console.log(style.dim(`  · ${f} (exists — use --force)`));
      // Baseline: sync the snapshot and record the pulled state as an already-applied migration, so
      // the schema matches the DB and `sz diff` doesn't report the freshly-pulled objects as pending.
      const base = await baseline(db, config);
      console.log(
        files.length
          ? `\n${ok(`Pulled ${plural(files.length, "schema")} into ${config.schema}.`)}`
          : ok("Nothing to pull."),
      );
      if (base.created)
        console.log(
          style.dim(
            `  baseline ${base.tag} recorded (snapshot synced, marked applied).`,
          ),
        );
    }),
  );
});

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}
program.parse();
