import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { DefineStatement } from "@schemic/core";
import { liftDb, type PortableDb } from "../driver/portable-ir";
import type { DbStructured } from "./structure";

/** A snapshot statement: the emitted DDL plus the source file it came from (for `diff` annotations). */
export type SnapshotStatement = DefineStatement & {
  /** Project-root-relative source file (absent for objects introspected from a live DB). */
  file?: string;
};

/**
 * The legacy STATEMENT snapshot (canonical SurrealQL DDL keyed by `kind:table:name`, + optional
 * Struct). No longer the stored form — it is the Surreal driver's INTERNAL diff data model
 * (`diffSnapshots`/`buildSnapshot`/`structuredSnapshot`), derived on demand from the portable IR.
 */
export interface Snapshot {
  version: 1;
  statements: Record<string, SnapshotStatement>;
  /**
   * The normalized Struct-IR of the same schema (added by `gen`/`baseline`). Used to render the
   * schema as TypeScript for `diff --ts`; absent in older snapshots (re-`gen` to populate it).
   */
  struct?: DbStructured;
}

/**
 * The STORED snapshot (`_snapshot.json`): the canonical **portable IR** is the single source of
 * truth; DDL is derived via the driver (`driver.emit`/`driver.diff`). Diffed against the next
 * `generate`. `files` maps each object's table/db-level name to its project-root-relative source
 * file (display-only; attached to diff items by the CLI). A v1 snapshot on disk is upgraded on read.
 */
export interface StoredSnapshot {
  version: 2;
  /** The driver that authored this snapshot ("surreal", "postgres", …). */
  driver: string;
  portable: PortableDb;
  files?: Record<string, string>;
}

/** A pre-portable (v1) snapshot still on disk, for read-compat. */
interface LegacySnapshotV1 {
  version: 1;
  statements: Record<string, SnapshotStatement>;
  struct?: DbStructured;
}

/** A migration file on disk. The filename is the source of truth — there's no journal. */
export interface Migration {
  /** Filename without the `.surql` extension, e.g. `20260607153045_add_users`. */
  tag: string;
  /** Filename, e.g. `20260607153045_add_users.surql`. */
  file: string;
}

/** The empty STATEMENT snapshot — the Surreal engine's "nothing yet" sentinel (e.g. baseline diff). */
export const EMPTY_SNAPSHOT: Snapshot = { version: 1, statements: {} };

const SNAPSHOT_FILE = "_snapshot.json";
const MIGRATION_EXT = ".surql";

/** A fresh empty STORED snapshot. Fresh each call so callers can't alias shared empty state. */
function emptyStored(): StoredSnapshot {
  return {
    version: 2,
    driver: "surreal",
    portable: { tables: [], functions: [], accesses: [] },
    files: {},
  };
}

/** The empty STORED snapshot — used as `prev` for a `--baseline` generate (diff against nothing). */
export const EMPTY_STORED: StoredSnapshot = emptyStored();

/** Read the stored snapshot, upgrading a legacy v1 (statement) snapshot to the portable form. */
export function readSnapshot(metaDir: string): StoredSnapshot {
  const path = join(metaDir, SNAPSHOT_FILE);
  if (!existsSync(path)) return emptyStored();
  const raw = JSON.parse(readFileSync(path, "utf8")) as
    | StoredSnapshot
    | LegacySnapshotV1;
  if (raw.version === 2) return { files: {}, ...raw };
  return upgradeV1(raw);
}

/** Lift a v1 statement snapshot into the portable form (Surreal-only — v1 predates multi-driver). */
function upgradeV1(v1: LegacySnapshotV1): StoredSnapshot {
  if (v1.struct)
    return {
      version: 2,
      driver: "surreal",
      portable: liftDb(v1.struct),
      files: {},
    };
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
