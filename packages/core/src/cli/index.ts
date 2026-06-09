import { watch as fsWatch } from "node:fs";
import { relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { Command, Option } from "commander";
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
import { init } from "./init";
import { applyStatements, diffAgainstDb, syncPlan } from "./introspect";
import {
  migrate,
  newMigration,
  planMigration,
  rollback,
  seed,
  status,
  unlock,
  writeMigration,
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
  opts: { down?: boolean; live?: boolean; full?: boolean },
  pending?: number,
): void {
  console.log(formatDiff(diff, { down: opts.down, full: opts.full }));
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
  $ sz generate add_users   create a migration from schema changes
  $ sz migrate              apply pending migrations
  $ sz sync --watch         keep the database in sync while you edit
  $ sz diff --live          show how the schema differs from the live database
`,
  );

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
        ? `\n${ok("Initialized. Edit database/schemas, then run `sz generate`.")}`
        : "\nNothing to do — already initialized.",
    );
  });

dbFlags(
  program
    .command("diff")
    .description("Show pending schema changes without writing a migration"),
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
    "--pager <cmd>",
    "page output through <cmd> (overrides your git diff viewer)",
  )
  .option("--no-pager", "don't page output through a diff viewer")
  .option("--json", "output the diff as JSON")
  .action(
    (
      opts: CommonOpts & {
        down?: boolean;
        live?: boolean;
        watch?: boolean;
        full?: boolean;
        patch?: boolean;
        pager?: string | boolean;
        json?: boolean;
      },
    ) => {
      run(async () => {
        const config = await loadConfig({ config: opts.config });
        // Seamlessly route through the user's git diff viewer (e.g. delta) when interactive:
        // a TTY, not watching, paging not disabled, and a pager resolves. `--patch` forces the
        // unified-diff format (to the pager, or to stdout when piped / `--no-pager`).
        // `--pager <cmd>` overrides; `--no-pager` (pager === false) disables; otherwise resolve the
        // git diff viewer. Only paginate when interactive (TTY, not watching).
        const pager =
          opts.pager === false || opts.watch || !process.stdout.isTTY
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
              const diff = await diffAgainstDb(db, config);
              const pending = (await status(db, config)).filter(
                (r) => !r.applied,
              ).length;
              await emit(diff, pending);
            } finally {
              if (!persistent) await db.close();
            }
          } else {
            await emit((await planMigration(config)).diff);
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

configFlag(
  program
    .command("generate [name]")
    .description("Diff schemas, preview the changes, and write a migration"),
)
  .option("-y, --yes", "use the given/default name without prompting")
  .action((name: string | undefined, opts: CommonOpts & { yes?: boolean }) => {
    run(async () => {
      const config = await loadConfig({ config: opts.config });
      const plan = await planMigration(config);
      if (isEmptyDiff(plan.diff)) {
        console.log(ok("No schema changes — nothing to generate."));
        return;
      }
      console.log("Changes to migrate:\n");
      console.log(formatDiff(plan.diff));
      console.log("");
      const title = name ?? (opts.yes ? undefined : await promptTitle());
      const res = writeMigration(config, plan, title);
      console.log(
        `${ok(res.file ?? "migration written")}  ${style.dim(`(+${res.up} up / ${res.down} down)`)}`,
      );
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
          console.log("No migrations yet. Run `sz generate`.");
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

configFlag(
  program
    .command("check")
    .description("Validate schemas without connecting to a database"),
).action((opts: CommonOpts) => {
  run(async () => {
    const config = await loadConfig({ config: opts.config });
    const dups = await duplicateTables(config.schemaPath);
    if (dups.size) {
      const lines = formatDuplicates(dups, config.root).map((l) => `  ${l}`);
      throw new Error(`${duplicateHeader(dups.size)}\n${lines.join("\n")}`);
    }
    const { tables, events } = await loadDefs(config.schemaPath);
    const kinds = summarizeKinds(
      Object.values(buildSnapshot(tables, events).statements).map((s) => s.ddl),
    );
    console.log(ok(`Schemas valid${kinds ? ` — ${kinds}` : " (no objects)"}.`));
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
).action(
  (
    opts: CommonOpts & { prune?: boolean; dryRun?: boolean; watch?: boolean },
  ) => {
    run(async () => {
      const config = await loadConfig({ config: opts.config });
      const once = async (db: Surreal) => {
        const diff = await diffAgainstDb(db, config);
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

dbFlags(
  program
    .command("pull")
    .description("Generate Zod schema files from the live database")
    .option("--force", "overwrite existing schema files"),
).action((opts: CommonOpts & { force?: boolean }) => {
  run(() =>
    withDb(opts, async (db, config) => {
      const { files, skipped } = await pull(db, config, { force: opts.force });
      for (const f of files) console.log(`  ${style.green("+")} ${f}`);
      for (const f of skipped)
        console.log(style.dim(`  · ${f} (exists — use --force)`));
      console.log(
        files.length
          ? `\n${ok(`Pulled ${plural(files.length, "schema")} into ${config.schema}.`)}`
          : ok("Nothing to pull."),
      );
    }),
  );
});

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}
program.parse();
