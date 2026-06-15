import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Surreal } from "surrealdb";
import { type Driver, getDriver, type MigrationStore } from "../driver";
import type { Shape, StandaloneDef, TableDef } from "../pure";
import type { ResolvedConfig } from "./config";
import { makeJiti } from "./config";
import { type Diff, isEmptyDiff } from "./diff";
import {
  type Filter,
  filterPortable,
  intersectPortable,
  mergeStored,
  parseFilter,
} from "./filter";
import {
  checksum,
  EMPTY_STORED,
  listMigrations,
  type Migration,
  readSnapshot,
  type StoredSnapshot,
  slug,
  timestamp,
  writeSnapshot,
} from "./meta";
import { type AnyTable, loadDefs } from "./schema";

/**
 * Build the canonical STORED snapshot from the authored schema: lower to the portable IR via the
 * driver, plus a name->source-file map (display-only; attached to diff items by `attachFiles`).
 */
function buildStored(
  driver: Driver,
  tables: AnyTable[],
  defs: StandaloneDef[],
  opts: { fileOf?: Map<unknown, string>; root?: string } = {},
): StoredSnapshot {
  const portable = driver.lower(
    tables as unknown as TableDef<string, Shape>[],
    defs,
  );
  const files: Record<string, string> = {};
  const rel = (abs: string) => (opts.root ? relative(opts.root, abs) : abs);
  for (const t of tables) {
    const abs = opts.fileOf?.get(t);
    if (abs) files[t.name] = rel(abs);
  }
  for (const d of defs) {
    const abs = opts.fileOf?.get(d);
    if (abs) files[d.kind === "event" ? d.table : d.name] = rel(abs);
  }
  return { version: 2, driver: driver.name, portable, files };
}

/** The driver's apply-time migration bookkeeping (the dialect SQL behind `migrate`/`rollback`/…). */
function migStore(config: ResolvedConfig): MigrationStore<unknown> {
  const driver = getDriver(config.driver ?? "surreal");
  if (!driver.migrations)
    throw new Error(
      `The "${driver.name}" driver does not support running migrations.`,
    );
  return driver.migrations;
}

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
  const driver = getDriver(config.driver ?? "surreal");
  const next = buildStored(driver, tables, defs, { fileOf, root: config.root });
  const prev = opts.baseline ? EMPTY_STORED : readSnapshot(config.metaDir);
  const diff = driver.diff(
    filterPortable(prev.portable, filter),
    filterPortable(next.portable, filter),
  );
  attachFiles(diff, prev.files ?? {}, next.files ?? {});
  // Persist only the generated kinds; excluded kinds (e.g. access) keep their prior snapshot state.
  return { diff, next: mergeStored(prev, next, filter) };
}

/**
 * A fresh, sortable migration tag: a UTC timestamp prefix + name slug. If a file with that tag
 * already exists (two migrations in the same second), the timestamp is bumped a second at a time
 * so the result is unique and ordering stays monotonic.
 */
function nextTag(migrationsDir: string, name: string): string {
  const s = slug(name);
  const date = new Date();
  let tag = `${timestamp(date)}_${s}`;
  while (existsSync(join(migrationsDir, `${tag}.surql`))) {
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
  const tag = nextTag(config.migrationsDir, name ?? "migration");
  return {
    tag,
    file: `${tag}.surql`,
    content: migStore(config).render(tag, diff),
    next,
    up: diff.up.length,
    down: diff.down.length,
  };
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
  db: Surreal,
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
  db: Surreal,
  config: ResolvedConfig,
  filter: Filter = parseFilter({}),
): Promise<GenerateResult> {
  const driver = getDriver(config.driver ?? "surreal");
  // What actually exists in the live DB (canonical portable IR), used ONLY to scope the baseline:
  // hand-written schema not yet in the DB stays pending for the next `schemic gen` rather than being
  // silently marked applied.
  const live = driver.normalize(
    await driver.introspect(
      db,
      new Set([config.migrationsTable, `${config.migrationsTable}_lock`]),
    ),
  );
  // The snapshot stores GENERATOR-form schema (what `schemic gen`/`schemic diff` compare against
  // offline). We take the just-pulled disk schema and keep only the objects present in the DB —
  // intersecting by name so the stored form stays the canonical (generator) one, not the INFO form.
  const { tables, defs, fileOf } = await loadDefs(config.schemaPath);
  const disk = buildStored(driver, tables, defs, {
    fileOf,
    root: config.root,
  });
  const pulledPortable = intersectPortable(disk.portable, live, filter);
  const pulled: StoredSnapshot = {
    version: 2,
    driver: driver.name,
    portable: pulledPortable,
    files: disk.files,
  };

  const prev = readSnapshot(config.metaDir);
  const diff = driver.diff(
    filterPortable(prev.portable, filter),
    pulledPortable,
  );
  attachFiles(diff, prev.files ?? {}, pulled.files ?? {});
  const plan: MigrationPlan = {
    diff,
    next: mergeStored(prev, pulled, filter),
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
  const migs = listMigrations(config.migrationsDir);
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
  db: Surreal,
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
  db: Surreal,
  config: ResolvedConfig,
): Promise<void> {
  await migStore(config).unlock(db, config.migrationsTable);
}

/**
 * Apply pending migrations in order — all, the next `count`, or up to and including `to`.
 * Takes an advisory lock so concurrent runs can't race.
 */
export async function migrate(
  db: Surreal,
  config: ResolvedConfig,
  opts: { count?: number; to?: string } = {},
): Promise<MigrateResult> {
  const mig = migStore(config);
  const table = config.migrationsTable;
  await mig.ensure(db, table);
  const migrations = listMigrations(config.migrationsDir);
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
  db: Surreal,
  config: ResolvedConfig,
): Promise<StatusRow[]> {
  const mig = migStore(config);
  await mig.ensure(db, config.migrationsTable);
  const applied = await mig.applied(db, config.migrationsTable);
  const files = listMigrations(config.migrationsDir);
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
  db: Surreal,
  config: ResolvedConfig,
  opts: { count?: number; to?: string } = {},
): Promise<Migration[]> {
  const mig = migStore(config);
  const table = config.migrationsTable;
  await mig.ensure(db, table);
  const migrations = listMigrations(config.migrationsDir);
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

const SURQL_STUB = (tag: string) => `-- ${tag} — hand-written migration.
IF $direction = "up" {
    -- forward changes
} ELSE {
    -- rollback changes
};
`;

/** Scaffold a blank, hand-written `.surql` migration with up/down branches. */
export function newMigration(
  config: ResolvedConfig,
  name: string,
): { tag: string; file: string } {
  mkdirSync(config.migrationsDir, { recursive: true });
  const tag = nextTag(config.migrationsDir, name);
  const file = `${tag}.surql`;
  writeFileSync(join(config.migrationsDir, file), SURQL_STUB(tag));
  return { tag, file };
}

/** Run the project's seed script (`config.seed` or `database/seed.ts`) with a connected client. */
export async function seed(db: Surreal, config: ResolvedConfig): Promise<void> {
  const path = config.seed
    ? resolve(config.root, config.seed)
    : resolve(config.root, "database/seed.ts");
  if (!existsSync(path)) throw new Error(`Seed file not found: ${path}`);
  const mod = (await makeJiti().import(path)) as Record<string, unknown> & {
    default?: unknown;
  };
  const fn = (typeof mod.default === "function" ? mod.default : mod.seed) as
    | ((db: Surreal) => Promise<unknown>)
    | undefined;
  if (typeof fn !== "function") {
    throw new Error("Seed file must export a default function `(db) => …`.");
  }
  await fn(db);
}
