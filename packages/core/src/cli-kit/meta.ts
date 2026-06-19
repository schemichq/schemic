import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { KindSnapshot } from "../kind";

// The legacy STATEMENT snapshot types (Snapshot/SnapshotStatement/EMPTY_SNAPSHOT) now live in
// cli/structure.ts (the SurrealDB module that produces them) — this file is the NEUTRAL stored-
// snapshot + migration-file engine.

/**
 * The STORED snapshot (`_snapshot.json`): the canonical schema is portable objects grouped by kind
 * (a {@link KindSnapshot}); DDL is derived generically via the kind registry (`buildKindDiff`/
 * `emitKinds`). Diffed against the next `generate`. `files` maps each object's name to its
 * project-root-relative source file (display-only; attached to diff items by the CLI). Pre-launch:
 * the format is free to change, so there is no on-disk version migration — an unrecognized snapshot
 * is treated as empty (regenerate via `schemic gen --baseline`).
 */
export interface StoredSnapshot {
  version: 3;
  /** The driver that authored this snapshot ("surrealdb", "postgres", …). */
  driver: string;
  /** Portable objects grouped by kind. */
  schema: KindSnapshot;
  files?: Record<string, string>;
}

/** A migration file on disk. The filename is the source of truth — there's no journal. */
export interface Migration {
  /** Filename without the `.surql` extension, e.g. `20260607153045_add_users`. */
  tag: string;
  /** Filename, e.g. `20260607153045_add_users.surql`. */
  file: string;
}

const SNAPSHOT_FILE = "_snapshot.json";
/** Fallback migration extension when a caller has no driver to hand (the driver provides the real one). */
const DEFAULT_MIGRATION_EXT = ".surql";

/** A fresh empty STORED snapshot. Fresh each call so callers can't alias shared empty state. */
function emptyStored(): StoredSnapshot {
  return {
    version: 3,
    driver: "surrealdb",
    schema: { kinds: {} },
    files: {},
  };
}

/** The empty STORED snapshot — used as `prev` for a `--baseline` generate (diff against nothing). */
export const EMPTY_STORED: StoredSnapshot = emptyStored();

/**
 * Read the stored snapshot. Pre-launch: any snapshot that isn't the current `version: 3` shape (a
 * pre-portable v1/v2, or absent) is treated as EMPTY — regenerate with `schemic gen --baseline`.
 */
export function readSnapshot(metaDir: string): StoredSnapshot {
  const path = join(metaDir, SNAPSHOT_FILE);
  if (!existsSync(path)) return emptyStored();
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<StoredSnapshot>;
  if (raw.version === 3 && raw.driver && raw.schema)
    return { files: {}, ...(raw as StoredSnapshot) };
  return emptyStored();
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
 * ones). The `meta/` directory and any file not ending in `ext` (the driver's migration extension)
 * are ignored.
 */
export function listMigrations(
  migrationsDir: string,
  ext: string = DEFAULT_MIGRATION_EXT,
): Migration[] {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((file) => ({ tag: file.slice(0, -ext.length), file }));
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
