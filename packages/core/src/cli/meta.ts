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
import type { DbStructured } from "./structure";

/** A snapshot statement: the emitted DDL plus the source file it came from (for `diff` annotations). */
export type SnapshotStatement = DefineStatement & {
  /** Project-root-relative source file (absent for objects introspected from a live DB). */
  file?: string;
};

/** Canonical schema state used to diff against the next `generate`. */
export interface Snapshot {
  version: 1;
  statements: Record<string, SnapshotStatement>;
  /**
   * The normalized Struct-IR of the same schema (added by `gen`/`baseline`). Used to render the
   * schema as TypeScript for `diff --ts`; absent in older snapshots (re-`gen` to populate it).
   */
  struct?: DbStructured;
}

/** A migration file on disk. The filename is the source of truth — there's no journal. */
export interface Migration {
  /** Filename without the `.surql` extension, e.g. `20260607153045_add_users`. */
  tag: string;
  /** Filename, e.g. `20260607153045_add_users.surql`. */
  file: string;
}

export const EMPTY_SNAPSHOT: Snapshot = { version: 1, statements: {} };

const SNAPSHOT_FILE = "_snapshot.json";
const MIGRATION_EXT = ".surql";

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function readSnapshot(metaDir: string): Snapshot {
  // Fresh fallback each call — callers may mutate the result.
  return readJson(join(metaDir, SNAPSHOT_FILE), { version: 1, statements: {} });
}

export function writeSnapshot(metaDir: string, snapshot: Snapshot): void {
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
