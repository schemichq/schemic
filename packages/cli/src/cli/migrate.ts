import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { ResolvedConfig } from "@schemic/core";
import {
  type Authored,
  type AuthoredDef,
  buildKindDiff,
  checksum,
  type Diff,
  type Driver,
  EMPTY_STORED,
  type Filter,
  filterKinds,
  getDriver,
  intersectKinds,
  isEmptyDiff,
  listMigrations,
  loadDefs,
  lowerSchema,
  type Migration,
  type MigrationStore,
  makeJiti,
  mergeStored,
  parseFilter,
  readSnapshot,
  type SeedContext,
  type StoredSnapshot,
  slug,
  snapshotKinds,
  snapshotObjects,
  style,
  timestamp,
  writeSnapshot,
} from "@schemic/core";

/**
 * Build the canonical STORED snapshot from the authored schema: explode authoring into kinded
 * definables, lower via the registry, plus a name->source-file map (display-only; attached to diff
 * items by `attachFiles`).
 */
function buildStored(
  driver: Driver,
  tables: Authored[],
  defs: AuthoredDef[],
  opts: { fileOf?: Map<unknown, string>; root?: string } = {},
): StoredSnapshot {
  const objects = lowerSchema(driver.registry, driver.explode(tables, defs));
  const files: Record<string, string> = {};
  const rel = (abs: string) => (opts.root ? relative(opts.root, abs) : abs);
  for (const t of tables) {
    const abs = opts.fileOf?.get(t);
    if (abs) files[t.name] = rel(abs);
  }
  for (const d of defs) {
    const abs = opts.fileOf?.get(d);
    // An event is file-linked under its owner table; other defs under their own name.
    const key = d.kind === "event" ? d.table : d.name;
    if (abs && key) files[key] = rel(abs);
  }
  return {
    version: 3,
    driver: driver.name,
    schema: snapshotKinds(objects, driver.registry),
    files,
  };
}

/** The driver's apply-time migration bookkeeping (the dialect SQL behind `migrate`/`rollback`/…). */
function migStore(config: ResolvedConfig): MigrationStore<unknown> {
  const driver = getDriver(config.driver ?? "surrealdb");
  if (!driver.migrations)
    throw new Error(
      `The "${driver.name}" driver does not support running migrations.`,
    );
  return driver.migrations;
}

/** The driver's migration-file extension (e.g. `.surql` / `.sql`); falls back to `.surql`. */
const migExt = (config: ResolvedConfig): string =>
  getDriver(config.driver ?? "surrealdb").migrations?.extension ?? ".surql";

/** Decorate diff items with their source file (from the snapshot `files` maps; driver leaves it unset). */
function attachFiles(
  diff: Diff,
  prevFiles: Record<string, string>,
  nextFiles: Record<string, string>,
): void {
  for (const it of diff.items ?? []) {
    const primary = it.op === "remove" ? prevFiles : nextFiles;
    it.file = primary[it.table] ?? nextFiles[it.table] ?? prevFiles[it.table];
  }
}

export type Direction = "up" | "down";

export interface GenerateResult {
  created: boolean;
  tag?: string;
  file?: string;
  up?: number;
  down?: number;
}

export interface MigrationPlan {
  diff: Diff;
  next: StoredSnapshot;
}

/**
 * Compute the pending diff (schemas vs snapshot) WITHOUT writing anything. With `baseline`, the
 * stored snapshot is ignored and the schema is diffed against an EMPTY snapshot — so the resulting
 * migration is the full schema, for regenerating a fresh baseline after removing all migrations.
 */
export async function planMigration(
  config: ResolvedConfig,
  filter: Filter = parseFilter({}),
  opts: { baseline?: boolean } = {},
): Promise<MigrationPlan> {
  const { tables, defs, fileOf } = await loadDefs(config.schemaPath);
  const driver = getDriver(config.driver ?? "surrealdb");
  const reg = driver.registry;
  const next = buildStored(driver, tables, defs, { fileOf, root: config.root });
  const prev = opts.baseline ? EMPTY_STORED : readSnapshot(config.metaDir);
  const diff = buildKindDiff(
    reg,
    filterKinds(reg, snapshotObjects(prev.schema), filter),
    filterKinds(reg, snapshotObjects(next.schema), filter),
  );
  attachFiles(diff, prev.files ?? {}, next.files ?? {});
  // Persist only the generated kinds; excluded kinds (e.g. access) keep their prior snapshot state.
  return { diff, next: mergeStored(reg, prev, next, filter) };
}

/**
 * A fresh, sortable migration tag: a UTC timestamp prefix + name slug. If a file with that tag
 * already exists (two migrations in the same second), the timestamp is bumped a second at a time
 * so the result is unique and ordering stays monotonic.
 */
function nextTag(migrationsDir: string, name: string, ext: string): string {
  const s = slug(name);
  const date = new Date();
  let tag = `${timestamp(date)}_${s}`;
  while (existsSync(join(migrationsDir, `${tag}${ext}`))) {
    date.setUTCSeconds(date.getUTCSeconds() + 1);
    tag = `${timestamp(date)}_${s}`;
  }
  return tag;
}

export interface PreparedMigration {
  tag: string;
  file: string;
  /** The rendered `.surql` program (what will be written to disk). */
  content: string;
  next: StoredSnapshot;
  up: number;
  down: number;
}

/** Compute a migration's tag, filename, and rendered `.surql` content WITHOUT writing anything. */
export function prepareMigration(
  config: ResolvedConfig,
  plan: MigrationPlan,
  name?: string,
): PreparedMigration | null {
  const { diff, next } = plan;
  if (isEmptyDiff(diff)) return null;
  mkdirSync(config.migrationsDir, { recursive: true });
  const ext = migExt(config);
  const tag = nextTag(config.migrationsDir, name ?? "migration", ext);
  return {
    tag,
    file: `${tag}${ext}`,
    content: migStore(config).render(tag, diff),
    next,
    up: diff.up.length,
    down: diff.down.length,
  };
}

/** The rendered migration body for a PREVIEW — nothing written, no tag allocated (shown by `gen` BEFORE
 *  the title prompt so you see what you're naming). The tag header reads `(unnamed)` until it's named. */
export function renderMigrationPreview(
  config: ResolvedConfig,
  diff: Diff,
): string {
  return migStore(config).render("(unnamed)", diff);
}

/** Write a prepared migration to disk (file + snapshot). */
export function commitMigration(
  config: ResolvedConfig,
  prepared: PreparedMigration,
): GenerateResult {
  mkdirSync(config.migrationsDir, { recursive: true });
  writeFileSync(join(config.migrationsDir, prepared.file), prepared.content);
  writeSnapshot(config.metaDir, prepared.next);
  return {
    created: true,
    tag: prepared.tag,
    file: prepared.file,
    up: prepared.up,
    down: prepared.down,
  };
}

/** Write a planned migration to disk (file + snapshot). No-op for an empty diff. */
export function writeMigration(
  config: ResolvedConfig,
  plan: MigrationPlan,
  name?: string,
): GenerateResult {
  const prepared = prepareMigration(config, plan, name);
  if (!prepared) return { created: false };
  return commitMigration(config, prepared);
}

/** Diff the schemas against the snapshot and, if anything changed, write a migration. */
export async function generate(
  config: ResolvedConfig,
  name?: string,
): Promise<GenerateResult> {
  return writeMigration(config, await planMigration(config), name);
}

/**
 * Record a migration as already-applied WITHOUT running it — used to baseline an existing database
 * (e.g. after `pull`), where the objects already exist so the DDL must not be re-executed.
 */
async function recordApplied(
  db: unknown,
  config: ResolvedConfig,
  m: PreparedMigration,
): Promise<void> {
  await migStore(config).record(db, config.migrationsTable, {
    tag: m.tag,
    file: m.file,
    checksum: checksum(m.content),
  });
}

/**
 * Baseline the project against the LIVE database (e.g. after `pull`): snapshot the current DB state
 * — respecting `filter`, the same one `pull` used — and, when it differs from the stored snapshot,
 * write a migration capturing that delta, recorded as already-applied (those objects already exist
 * in the DB, so the DDL must not re-run). Only what is actually in the DB is baselined: any
 * hand-written schema not yet in the DB stays pending for the next `schemic gen`. Returns the migration's
 * metadata, or `created: false` when nothing changed.
 */
export async function baseline(
  db: unknown,
  config: ResolvedConfig,
  filter: Filter = parseFilter({}),
): Promise<GenerateResult> {
  const driver = getDriver(config.driver ?? "surrealdb");
  const reg = driver.registry;
  // What actually exists in the live DB (canonical portable objects), used ONLY to scope the
  // baseline: hand-written schema not yet in the DB stays pending for the next `schemic gen` rather
  // than being silently marked applied. introspectAll already canonicalizes (== lowering).
  const live = await driver.introspectAll(
    db,
    new Set([config.migrationsTable, `${config.migrationsTable}_lock`]),
  );
  // The snapshot stores GENERATOR-form schema (what `schemic gen`/`schemic diff` compare against
  // offline). We take the just-pulled disk schema and keep only the objects present in the DB —
  // intersecting by `kind:name` so the stored form stays the canonical (generator) one, not the INFO form.
  const { tables, defs, fileOf } = await loadDefs(config.schemaPath);
  const disk = buildStored(driver, tables, defs, {
    fileOf,
    root: config.root,
  });
  const pulledObjects = intersectKinds(
    reg,
    snapshotObjects(disk.schema),
    live,
    filter,
  );
  const pulled: StoredSnapshot = {
    version: 3,
    driver: driver.name,
    schema: snapshotKinds(pulledObjects, driver.registry),
    files: disk.files,
  };

  const prev = readSnapshot(config.metaDir);
  const diff = buildKindDiff(
    reg,
    filterKinds(reg, snapshotObjects(prev.schema), filter),
    pulledObjects,
  );
  attachFiles(diff, prev.files ?? {}, pulled.files ?? {});
  const plan: MigrationPlan = {
    diff,
    next: mergeStored(reg, prev, pulled, filter),
  };
  const prepared = prepareMigration(config, plan, "baseline");
  if (!prepared) {
    // DB already matches the snapshot — just persist (in case excluded kinds shifted).
    writeSnapshot(config.metaDir, plan.next);
    return { created: false };
  }
  const res = commitMigration(config, prepared);
  await recordApplied(db, config, prepared);
  return res;
}

/** Delete every migration `.surql` file (the `meta/` snapshot is left intact); returns removed tags. */
export function clearMigrationFiles(config: ResolvedConfig): string[] {
  const migs = listMigrations(config.migrationsDir, migExt(config));
  for (const m of migs)
    rmSync(join(config.migrationsDir, m.file), { force: true });
  return migs.map((m) => m.tag);
}

/**
 * Reconcile the DB's migration history after a baseline squash (old migrations replaced by one
 * fresh baseline). When the live DB already matches the schema (`drift` false), drop the now-stale
 * applied-records and record the baseline as already-applied — its DDL is never re-run. When the DB
 * differs (`drift` true), leave the history untouched and report the baseline as still pending (the
 * next `schemic migrate` applies it). Caller handles the no-connection case.
 */
export async function reconcileBaseline(
  db: unknown,
  config: ResolvedConfig,
  prepared: PreparedMigration,
  drift: boolean,
): Promise<"applied" | "pending"> {
  const mig = migStore(config);
  await mig.ensure(db, config.migrationsTable);
  if (drift) return "pending";
  // DB == schema: the squashed objects already exist, so wipe the stale tags and mark the baseline
  // applied rather than re-running its DDL.
  await mig.clear(db, config.migrationsTable);
  await recordApplied(db, config, prepared);
  return "applied";
}

export interface MigrateResult {
  applied: Migration[];
}

/** The position of `tag` in the ordered migration list, or throw if it isn't known. */
function indexOfTag(migrations: Migration[], tag: string): number {
  const i = migrations.findIndex((m) => m.tag === tag);
  if (i < 0) throw new Error(`Unknown migration: ${tag}`);
  return i;
}

/** Manually clear a stale migration lock. */
export async function unlock(
  db: unknown,
  config: ResolvedConfig,
): Promise<void> {
  await migStore(config).unlock(db, config.migrationsTable);
}

/**
 * Apply pending migrations in order — all, the next `count`, or up to and including `to`.
 * Takes an advisory lock so concurrent runs can't race.
 */
export async function migrate(
  db: unknown,
  config: ResolvedConfig,
  opts: { count?: number; to?: string } = {},
): Promise<MigrateResult> {
  const mig = migStore(config);
  const table = config.migrationsTable;
  await mig.ensure(db, table);
  const migrations = listMigrations(config.migrationsDir, migExt(config));
  const applied = await mig.applied(db, table);
  let pending = migrations.filter((m) => !applied.has(m.tag));
  if (opts.to) {
    const targetIdx = indexOfTag(migrations, opts.to);
    const pos = new Map(migrations.map((m, i) => [m.tag, i]));
    pending = pending.filter((m) => (pos.get(m.tag) ?? 0) <= targetIdx);
  }
  if (opts.count !== undefined)
    pending = pending.slice(0, Math.max(0, opts.count));

  await mig.lock(db, table);
  try {
    for (const m of pending) {
      const content = readFileSync(join(config.migrationsDir, m.file), "utf8");
      await mig.apply(db, table, {
        content,
        direction: "up",
        record: { tag: m.tag, file: m.file, checksum: checksum(content) },
      });
    }
  } finally {
    await mig.unlock(db, table);
  }
  return { applied: pending };
}

export interface StatusRow {
  tag: string;
  applied: boolean;
  /** True if an applied migration's file was edited after it was applied. */
  drift?: boolean;
  /** True if the DB records it applied but the migration file is gone (orphaned bookkeeping). */
  missing?: boolean;
}

/** Recompute a migration file's checksum from its current contents (missing → ""). */
function currentChecksum(config: ResolvedConfig, m: Migration): string {
  const path = join(config.migrationsDir, m.file);
  if (!existsSync(path)) return "";
  return checksum(readFileSync(path, "utf8"));
}

/** Per-migration applied/pending status (+ drift), in apply order. Includes orphaned rows — tags the
 *  DB records applied whose files are gone — so a deleted-files / reset-snapshot drift is visible. */
export async function status(
  db: unknown,
  config: ResolvedConfig,
): Promise<StatusRow[]> {
  const mig = migStore(config);
  await mig.ensure(db, config.migrationsTable);
  const applied = await mig.applied(db, config.migrationsTable);
  const files = listMigrations(config.migrationsDir, migExt(config));
  const fileTags = new Set(files.map((m) => m.tag));
  const rows: StatusRow[] = files.map((m) => {
    const appliedSum = applied.get(m.tag);
    return {
      tag: m.tag,
      applied: appliedSum !== undefined,
      drift:
        appliedSum !== undefined && appliedSum !== currentChecksum(config, m),
    };
  });
  // Orphans: recorded applied in the DB but the file no longer exists on disk.
  for (const tag of applied.keys())
    if (!fileTags.has(tag)) rows.push({ tag, applied: true, missing: true });
  return rows.sort((a, b) => a.tag.localeCompare(b.tag));
}

/**
 * Roll back applied migrations (newest first): the last `count`, or everything applied after
 * `to` (leaving `to` as the latest applied). Takes the advisory lock.
 */
export async function rollback(
  db: unknown,
  config: ResolvedConfig,
  opts: { count?: number; to?: string } = {},
): Promise<Migration[]> {
  const mig = migStore(config);
  const table = config.migrationsTable;
  await mig.ensure(db, table);
  const migrations = listMigrations(config.migrationsDir, migExt(config));
  const applied = await mig.applied(db, table);
  const appliedMigrations = migrations.filter((m) => applied.has(m.tag));

  let toRevert: Migration[];
  if (opts.to) {
    const targetIdx = indexOfTag(migrations, opts.to);
    const pos = new Map(migrations.map((m, i) => [m.tag, i]));
    toRevert = appliedMigrations
      .filter((m) => (pos.get(m.tag) ?? 0) > targetIdx)
      .reverse();
  } else {
    toRevert = appliedMigrations.slice(-(opts.count ?? 1)).reverse();
  }

  await mig.lock(db, table);
  try {
    for (const m of toRevert) {
      const content = readFileSync(join(config.migrationsDir, m.file), "utf8");
      await mig.apply(db, table, {
        content,
        direction: "down",
        record: { tag: m.tag, file: m.file, checksum: checksum(content) },
      });
    }
  } finally {
    await mig.unlock(db, table);
  }
  return toRevert;
}

/** Run the project's seed script (`config.seed` or `database/seed.ts`) with a connected client. */
/** One runnable seed in a seed folder: its addressable `name` and its file `path`. */
interface SeedScript {
  name: string;
  path: string;
}

/** Seed-source extensions (a `.surql`/`.sql` next to a seed is a SUPPORTING file, never a seed). */
const SEED_EXT = /\.(ts|mts|cts|js|mjs|cjs)$/;
/** A leading `NN-`/`NN_` orders a seed in a folder but isn't part of its addressable name. */
const SEED_ORDER_PREFIX = /^\d+[-_]/;

/** The seed name a file addresses: extension dropped, an optional numeric order-prefix stripped. */
function seedName(file: string): string {
  return file.replace(SEED_EXT, "").replace(SEED_ORDER_PREFIX, "");
}

/**
 * Locate the project's seed source. A `database/seed/` (or `config.seed`) DIRECTORY is a folder of
 * named seeds; a `database/seed.ts` (or a `config.seed` file) is the single legacy seed. Returns the
 * directory's ordered scripts + whether it has an `index.ts` orchestrator, or the single file.
 */
function locateSeeds(config: ResolvedConfig): {
  dir?: { base: string; scripts: SeedScript[]; index?: string };
  file?: string;
} {
  const base = resolve(config.root, config.seed ?? "database/seed");
  if (existsSync(base) && statSync(base).isDirectory()) {
    let index: string | undefined;
    const scripts: SeedScript[] = [];
    for (const f of readdirSync(base).sort()) {
      // Only top-level script files are seeds; `.d.ts`, `_`-prefixed, and supporting files (`.surql`,
      // `.sql`, …) are skipped — supporting files are loaded BY a seed (`import … with { type: "text" }`).
      if (f.startsWith("_") || f.endsWith(".d.ts") || !SEED_EXT.test(f))
        continue;
      const path = join(base, f);
      if (statSync(path).isDirectory()) continue;
      if (seedName(f) === "index") index = path;
      else scripts.push({ name: seedName(f), path });
    }
    return { dir: { base, scripts, index } };
  }
  const file = SEED_EXT.test(base) ? base : `${base}.ts`;
  return { file: existsSync(file) ? file : base };
}

/** Load a seed module and run its default (or named `seed`) export against the live connection. */
async function runSeedFile(db: unknown, path: string): Promise<void> {
  if (!existsSync(path)) throw new Error(`Seed file not found: ${path}`);
  const mod = (await makeJiti().import(path)) as Record<string, unknown> & {
    default?: unknown;
  };
  // The seed callback is the user's own code against the live driver connection — they annotate it
  // with their SDK's client type (e.g. `Surreal`); the orchestration hands it the opaque `db` plus a
  // `ctx` scoped to the seed's directory (so a seed can `ctx.file("data.surql")` without an import).
  const fn = (typeof mod.default === "function" ? mod.default : mod.seed) as
    | ((db: unknown, ctx: SeedContext) => Promise<unknown>)
    | undefined;
  if (typeof fn !== "function")
    throw new Error(
      `Seed "${relative(process.cwd(), path)}" must export a default function \`(db, ctx) => …\`.`,
    );
  const dir = dirname(path);
  const ctx: SeedContext = {
    dir,
    file: (name) => readFileSync(resolve(dir, name), "utf8"),
  };
  await fn(db, ctx);
}

/**
 * Run the project's seed(s). A single `seed.ts` runs as-is. A `seed/` FOLDER holds named scripts:
 *  - `seed <name>` runs one (numeric order-prefix ignored: `01-users.ts` ⇄ `users`);
 *  - `seed --all` runs every script in filename order;
 *  - `seed` (no name) runs `index.ts` if present, else every script in order.
 */
export async function seed(
  db: unknown,
  config: ResolvedConfig,
  opts: { name?: string; all?: boolean } = {},
): Promise<void> {
  const { dir, file } = locateSeeds(config);

  if (!dir) {
    if (opts.name)
      throw new Error(
        `--name needs a seed folder (database/seed/); found a single seed file instead.`,
      );
    await runSeedFile(db, file as string);
    return;
  }

  const { base, scripts, index } = dir;
  const run = async (s: SeedScript) => {
    console.log(style.dim(`  → ${s.name}`));
    await runSeedFile(db, s.path);
  };

  if (opts.name) {
    const match = scripts.find((s) => s.name === opts.name);
    if (!match)
      throw new Error(
        `No seed named "${opts.name}". Available: ${
          scripts.map((s) => s.name).join(", ") || "(none)"
        }.`,
      );
    await run(match);
    return;
  }

  if (index && !opts.all) {
    await runSeedFile(db, index);
    return;
  }
  if (!scripts.length)
    throw new Error(`No seeds found in ${relative(process.cwd(), base)}/.`);
  for (const s of scripts) await run(s);
}
