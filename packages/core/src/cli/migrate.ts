import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { escapeIdent, type Surreal } from "surrealdb";
import type { ResolvedConfig } from "./config";
import { makeJiti } from "./config";
import {
  buildSnapshot,
  type Diff,
  diffSnapshots,
  isEmptyDiff,
  renderMigration,
} from "./diff";
import {
  checksum,
  listMigrations,
  type Migration,
  readSnapshot,
  type Snapshot,
  slug,
  timestamp,
  writeSnapshot,
} from "./meta";
import { loadDefs } from "./schema";

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
  next: Snapshot;
}

/** Compute the pending diff (schemas vs snapshot) WITHOUT writing anything. */
export async function planMigration(
  config: ResolvedConfig,
): Promise<MigrationPlan> {
  const { tables, events } = await loadDefs(config.schemaPath);
  const next = buildSnapshot(tables, events);
  const diff = diffSnapshots(readSnapshot(config.metaDir), next);
  return { diff, next };
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

/** Write a planned migration to disk (file + snapshot). No-op for an empty diff. */
export function writeMigration(
  config: ResolvedConfig,
  plan: MigrationPlan,
  name?: string,
): GenerateResult {
  const { diff, next } = plan;
  if (isEmptyDiff(diff)) return { created: false };

  mkdirSync(config.migrationsDir, { recursive: true });
  const tag = nextTag(config.migrationsDir, name ?? "migration");
  const file = `${tag}.surql`;
  writeFileSync(join(config.migrationsDir, file), renderMigration(tag, diff));
  writeSnapshot(config.metaDir, next);

  return {
    created: true,
    tag,
    file,
    up: diff.up.length,
    down: diff.down.length,
  };
}

/** Diff the schemas against the snapshot and, if anything changed, write a migration. */
export async function generate(
  config: ResolvedConfig,
  name?: string,
): Promise<GenerateResult> {
  return writeMigration(config, await planMigration(config), name);
}

/** `DEFINE TABLE … SCHEMALESS` for the internal migrations-tracking table. */
async function ensureMigrationsTable(
  db: Surreal,
  table: string,
): Promise<void> {
  await db.query(
    `DEFINE TABLE IF NOT EXISTS ${escapeIdent(table)} TYPE NORMAL SCHEMALESS PERMISSIONS NONE;`,
  );
}

/** Applied migrations recorded in the DB, as `tag -> checksum-at-apply-time`. */
async function appliedRecords(
  db: Surreal,
  table: string,
): Promise<Map<string, string>> {
  const [rows] = await db.query<[{ tag: string; checksum: string }[]]>(
    "SELECT tag, checksum FROM type::table($tbl)",
    { tbl: table },
  );
  return new Map((rows ?? []).map((r) => [r.tag, r.checksum]));
}

const lockTable = (config: ResolvedConfig) => `${config.migrationsTable}_lock`;

/** Take an advisory lock so two `migrate`/`rollback` runs can't race. Throws if already held. */
async function acquireLock(db: Surreal, config: ResolvedConfig): Promise<void> {
  const tbl = lockTable(config);
  await db.query(
    `DEFINE TABLE IF NOT EXISTS ${escapeIdent(tbl)} TYPE NORMAL SCHEMALESS PERMISSIONS NONE;`,
  );
  try {
    await db.query(
      "CREATE type::record($tbl, 'lock') CONTENT { at: time::now() }",
      { tbl },
    );
  } catch {
    throw new Error(
      "Migrations are locked — another run is in progress. If it's stale, run `sz unlock`.",
    );
  }
}

async function releaseLock(db: Surreal, config: ResolvedConfig): Promise<void> {
  await db.query("DELETE type::record($tbl, 'lock')", {
    tbl: lockTable(config),
  });
}

/** Manually clear a stale migration lock. */
export async function unlock(
  db: Surreal,
  config: ResolvedConfig,
): Promise<void> {
  await releaseLock(db, config);
}

/** A bookkeeping write applied together with the migration (so they commit atomically). */
interface Bookkeep {
  sql: string;
  vars: Record<string, unknown>;
}

/**
 * Run one migration's `up` or `down` plus its bookkeeping write in a single `BEGIN/COMMIT`, so
 * the migration is recorded iff it actually applied.
 */
async function applyMigration(
  db: Surreal,
  config: ResolvedConfig,
  m: Migration,
  direction: Direction,
  bookkeep: Bookkeep,
): Promise<void> {
  const sql = readFileSync(join(config.migrationsDir, m.file), "utf8");
  await db.query(`BEGIN;\n${sql}\n${bookkeep.sql};\nCOMMIT;`, {
    direction,
    ...bookkeep.vars,
  });
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

/**
 * Apply pending migrations in order — all, the next `count`, or up to and including `to`.
 * Takes an advisory lock so concurrent runs can't race.
 */
export async function migrate(
  db: Surreal,
  config: ResolvedConfig,
  opts: { count?: number; to?: string } = {},
): Promise<MigrateResult> {
  await ensureMigrationsTable(db, config.migrationsTable);
  const migrations = listMigrations(config.migrationsDir);
  const applied = await appliedRecords(db, config.migrationsTable);
  let pending = migrations.filter((m) => !applied.has(m.tag));
  if (opts.to) {
    const targetIdx = indexOfTag(migrations, opts.to);
    const pos = new Map(migrations.map((m, i) => [m.tag, i]));
    pending = pending.filter((m) => (pos.get(m.tag) ?? 0) <= targetIdx);
  }
  if (opts.count !== undefined)
    pending = pending.slice(0, Math.max(0, opts.count));

  await acquireLock(db, config);
  try {
    for (const m of pending) {
      await applyMigration(db, config, m, "up", {
        sql: "CREATE type::record($tbl, $tag) CONTENT { tag: $tag, file: $file, checksum: $sum, applied_at: time::now() }",
        vars: {
          tbl: config.migrationsTable,
          tag: m.tag,
          file: m.file,
          sum: currentChecksum(config, m),
        },
      });
    }
  } finally {
    await releaseLock(db, config);
  }
  return { applied: pending };
}

export interface StatusRow {
  tag: string;
  applied: boolean;
  /** True if an applied migration's file was edited after it was applied. */
  drift?: boolean;
}

/** Recompute a migration file's checksum from its current contents (missing → ""). */
function currentChecksum(config: ResolvedConfig, m: Migration): string {
  const path = join(config.migrationsDir, m.file);
  if (!existsSync(path)) return "";
  return checksum(readFileSync(path, "utf8"));
}

/** Per-migration applied/pending status (+ drift), in apply order. */
export async function status(
  db: Surreal,
  config: ResolvedConfig,
): Promise<StatusRow[]> {
  await ensureMigrationsTable(db, config.migrationsTable);
  const applied = await appliedRecords(db, config.migrationsTable);
  return listMigrations(config.migrationsDir).map((m) => {
    const appliedSum = applied.get(m.tag);
    return {
      tag: m.tag,
      applied: appliedSum !== undefined,
      drift:
        appliedSum !== undefined && appliedSum !== currentChecksum(config, m),
    };
  });
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
  await ensureMigrationsTable(db, config.migrationsTable);
  const migrations = listMigrations(config.migrationsDir);
  const applied = await appliedRecords(db, config.migrationsTable);
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

  await acquireLock(db, config);
  try {
    for (const m of toRevert) {
      await applyMigration(db, config, m, "down", {
        sql: "DELETE type::record($tbl, $tag)",
        vars: { tbl: config.migrationsTable, tag: m.tag },
      });
    }
  } finally {
    await releaseLock(db, config);
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
