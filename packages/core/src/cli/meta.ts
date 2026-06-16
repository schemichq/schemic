import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Driver } from "../driver";
import type { PortableDb } from "../driver/portable-ir";

// The legacy STATEMENT snapshot types (Snapshot/SnapshotStatement/EMPTY_SNAPSHOT) now live in
// cli/structure.ts (the SurrealDB module that produces them) — this file is the NEUTRAL stored-
// snapshot + migration-file engine.

/**
 * The STORED snapshot (`_snapshot.json`): the canonical **portable IR** is the single source of
 * truth; DDL is derived via the driver (`driver.emit`/`driver.diff`). Diffed against the next
 * `generate`. `files` maps each object's table/db-level name to its project-root-relative source
 * file (display-only; attached to diff items by the CLI). A v1 snapshot on disk is upgraded on read.
 */
export interface StoredSnapshot {
  version: 2;
  /** The driver that authored this snapshot ("surrealdb", "postgres", …). */
  driver: string;
  portable: PortableDb;
  files?: Record<string, string>;
}

/** A pre-portable (v1) statement snapshot still on disk, for read-compat (lifted to portable). */
interface LegacySnapshotV1 {
  version: 1;
  statements?: Record<string, unknown>;
  /** The driver-private legacy struct (Surreal's string-kind IR) — opaque here; the driver lifts it. */
  struct?: unknown;
}

/** A migration file on disk. The filename is the source of truth — there's no journal. */
export interface Migration {
  /** Filename without the `.surql` extension, e.g. `20260607153045_add_users`. */
  tag: string;
  /** Filename, e.g. `20260607153045_add_users.surql`. */
  file: string;
}

const SNAPSHOT_FILE = "_snapshot.json";
const MIGRATION_EXT = ".surql";

/** A fresh empty STORED snapshot. Fresh each call so callers can't alias shared empty state. */
function emptyStored(): StoredSnapshot {
  return {
    version: 2,
    driver: "surrealdb",
    portable: { tables: [], functions: [], accesses: [] },
    files: {},
  };
}

/** The empty STORED snapshot — used as `prev` for a `--baseline` generate (diff against nothing). */
export const EMPTY_STORED: StoredSnapshot = emptyStored();

/**
 * Read the stored snapshot, upgrading a legacy v1 (statement) snapshot to the portable form. A v1
 * upgrade needs the `driver` (only it knows how to lift its legacy struct); v2 reads don't.
 */
export function readSnapshot(
  metaDir: string,
  driver?: Pick<Driver, "name" | "upgradeSnapshot">,
): StoredSnapshot {
  const path = join(metaDir, SNAPSHOT_FILE);
  if (!existsSync(path)) return emptyStored();
  const raw = JSON.parse(readFileSync(path, "utf8")) as
    | StoredSnapshot
    | LegacySnapshotV1;
  if (raw.version === 2) return { files: {}, ...raw };
  return upgradeV1(raw, driver);
}

/** Lift a v1 statement snapshot into the portable form via the driver's `upgradeSnapshot` hook. */
function upgradeV1(
  v1: LegacySnapshotV1,
  driver?: Pick<Driver, "name" | "upgradeSnapshot">,
): StoredSnapshot {
  if (v1.struct) {
    if (!driver?.upgradeSnapshot)
      throw new Error(
        "This snapshot predates the portable format and the active driver can't upgrade it. " +
          "Run `schemic snapshot reset` then `schemic gen --baseline` to regenerate it.",
      );
    return {
      version: 2,
      driver: driver.name ?? "surrealdb",
      portable: driver.upgradeSnapshot(v1.struct),
      files: {},
    };
  }
  if (Object.keys(v1.statements ?? {}).length === 0) return emptyStored();
  throw new Error(
    "The migration snapshot predates the portable format and has no recorded Struct. " +
      "Run `schemic snapshot reset` then `schemic gen --baseline` to regenerate it.",
  );
}

export function writeSnapshot(metaDir: string, snapshot: StoredSnapshot): void {
  mkdirSync(metaDir, { recursive: true });
  writeFileSync(
    join(metaDir, SNAPSHOT_FILE),
    `${JSON.stringify(snapshot, null, 2)}\n`,
  );
}

/**
 * All migration files in `migrationsDir`, in apply order. Filenames are timestamp-prefixed, so
 * a plain ascending sort is chronological (and legacy `0001_` names sort before timestamped
 * ones). The `meta/` directory and any non-`.surql` files are ignored.
 */
export function listMigrations(migrationsDir: string): Migration[] {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(MIGRATION_EXT))
    .sort()
    .map((file) => ({ tag: file.slice(0, -MIGRATION_EXT.length), file }));
}

/** A sortable UTC timestamp prefix for a new migration, e.g. `20260607153045`. */
export function timestamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}` +
    p(date.getUTCMonth() + 1) +
    p(date.getUTCDate()) +
    p(date.getUTCHours()) +
    p(date.getUTCMinutes()) +
    p(date.getUTCSeconds())
  );
}

/** sha256 of a migration file's contents (drift detection / apply-time bookkeeping). */
export function checksum(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** Turn a free-form migration name into a filename-safe slug. */
export function slug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "migration"
  );
}
