// The DRIVER interface — the dialect seam for multi-DB support (see docs/MULTI-DB-SPIKE.md).
//
// Everything dialect-specific lives behind a `Driver`: lowering authoring to the Struct-IR, emitting
// DDL, introspecting a live DB, normalizing to a canonical form, and executing. Everything ABOVE the
// driver (the diff algorithm, the magicast TS-merge, the migration model, the CLI shell) stays
// dialect-free and calls these ops.
//
// The connection type is a driver-private parameter `Conn`: the orchestration treats it opaquely and
// only ever hands it back to the SAME driver. So the Surreal driver is `Driver<Surreal>`, a future
// Postgres driver is `Driver<PgClient>`, and core never sees either concrete type.

import type { ResolvedConfig } from "../cli/config";
import type { Diff } from "../cli/diff";
import type { DefineStatement } from "../ddl";
import type { Shape, StandaloneDef, TableDef } from "../pure";
import type { PortableDb } from "./portable-ir";

/** A single emitted DDL statement, structured (carries identity + the dialect `ddl` string). */
export type Statement = DefineStatement;

/** Options for {@link Driver.emit} — mirrors the existing `DefineOptions` (e.g. IF NOT EXISTS). */
export interface EmitOptions {
  ifNotExists?: boolean;
  overwrite?: boolean;
}

/** Options for {@link Driver.apply}. */
export interface ApplyOptions {
  /**
   * Run the whole batch atomically. `migrate` wraps up/down + `_migrations` bookkeeping in one
   * transaction; a driver that can't MUST surface that (the migration model degrades to best-effort).
   */
  transactional?: boolean;
}

/** Per-connection overrides (url/namespace/credentials) — superset across dialects. */
export interface ConnectionOverrides {
  url?: string;
  namespace?: string;
  database?: string;
  username?: string;
  password?: string;
  authLevel?: string;
}

/** The direction a migration is applied in. */
export type MigrationDirection = "up" | "down";

/** A migration's bookkeeping identity, recorded in the migrations-tracking table. */
export interface MigrationRecord {
  tag: string;
  file: string;
  /** sha of the migration file at apply time (drift detection). */
  checksum: string;
}

/**
 * The apply-time, dialect-specific half of the migration runner. The orchestration (which
 * migrations are pending, ordering, the lock-then-loop) stays driver-neutral in cli/migrate.ts;
 * this capability owns the SQL: the tracking table, the applied-records, the advisory lock, and the
 * atomic apply+record. A driver WITHOUT it can't run migrations (diff/gen still work). `Conn` is the
 * driver's own connection type.
 */
export interface MigrationStore<Conn = unknown> {
  /** Render a diff as this dialect's migration-file body (e.g. SurrealQL `IF $direction` up/down). */
  render(tag: string, diff: Diff): string;
  /** Ensure the migrations-tracking table exists. */
  ensure(conn: Conn, table: string): Promise<void>;
  /** Applied migrations: tag -> checksum recorded at apply time. */
  applied(conn: Conn, table: string): Promise<Map<string, string>>;
  /**
   * Apply one migration's `up`/`down` PROGRAM plus its bookkeeping write atomically: on `up` record
   * the migration, on `down` erase it — so the record is written iff the DDL actually applied.
   */
  apply(
    conn: Conn,
    table: string,
    m: {
      content: string;
      direction: MigrationDirection;
      record: MigrationRecord;
    },
  ): Promise<void>;
  /** Record a migration as applied WITHOUT running its DDL (baseline of an existing DB). */
  record(conn: Conn, table: string, record: MigrationRecord): Promise<void>;
  /** Drop all applied records (baseline-squash reconcile). */
  clear(conn: Conn, table: string): Promise<void>;
  /** Take an advisory lock so two runs can't race — throws if already held. */
  lock(conn: Conn, table: string): Promise<void>;
  /** Release the advisory lock (idempotent). */
  unlock(conn: Conn, table: string): Promise<void>;
}

/**
 * An OPTIONAL throwaway-instance capability for round-trip canonicalization and `sz check`'s
 * migration replay. A driver WITHOUT this must provide a `normalize()` strong enough to canonicalize
 * purely; on such a driver `check`/replay-verification is degraded/unavailable (diff/apply still work).
 */
export interface ShadowCapability<Conn> {
  /** Apply `ddl` to a fresh scratch DB, introspect it back to the portable IR, then drop it. */
  roundTrip(
    conn: Conn,
    config: ResolvedConfig,
    ddl: string,
  ): Promise<PortableDb>;
  /** Spin up a fully-isolated ephemeral instance (for migration replay). Caller must `stop()`. */
  ephemeral?(): Promise<{ conn: Conn; stop: () => Promise<void> }>;
}

/**
 * A database dialect. The five IR ops (`lower`/`emit`/`introspect`/`normalize` + `connect`/`apply`)
 * all pivot on the PORTABLE Struct-IR (`PortableDb` — dialect-independent field types); `equal` is
 * the structured comparison the dialect-free diff core uses. A driver translates the portable IR
 * to/from its own dialect (the Surreal driver lifts/lowers the SurrealQL string kinds; the Postgres
 * driver produces/consumes the portable IR natively).
 */
export interface Driver<Conn = unknown> {
  readonly name: string;

  // --- IR pipeline ---------------------------------------------------------------------------
  /** Authoring (loaded `defineTable`/standalone defs) -> NORMALIZED portable IR. */
  lower(tables: TableDef<string, Shape>[], defs: StandaloneDef[]): PortableDb;
  /** Portable IR -> ordered DDL statements (a fresh apply / migration `up`). */
  emit(db: PortableDb, opts?: EmitOptions): Statement[];
  /** DROP/REMOVE DDL for one object — `up` for a removed object, `down` for an added one. */
  remove(statement: Statement): string;
  /** ALTER/OVERWRITE DDL for one changed object (replace-in-place where the dialect can). */
  overwrite(statement: Statement): string;
  /** Live connection -> portable IR (skipping `exclude`d tables). */
  introspect(conn: Conn, exclude?: Set<string>): Promise<PortableDb>;
  /** Portable IR -> canonical portable IR (deterministic; both lowerings converge here). */
  normalize(db: PortableDb): PortableDb;
  /** Structured equality over the canonical portable IR (the dialect-free diff core's comparison). */
  equal(a: PortableDb, b: PortableDb): boolean;
  /**
   * Diff two portable IRs into executable `up`/`down` DDL (+ display items). The dialect owns the
   * strategy: SurrealDB does clause-level `ALTER`/`OVERWRITE`; a coarser driver recreates objects.
   * `prev` is the stored/live state, `next` the desired schema. Source-file linkage on the items is
   * attached by the caller (the snapshot's `files` map), so a driver leaves `DiffItem.file` unset.
   */
  diff(prev: PortableDb, next: PortableDb): Diff;

  // --- execution -----------------------------------------------------------------------------
  connect(config: ResolvedConfig, over?: ConnectionOverrides): Promise<Conn>;
  apply(conn: Conn, statements: string[], opts?: ApplyOptions): Promise<void>;

  // --- optional capabilities -----------------------------------------------------------------
  readonly shadow?: ShadowCapability<Conn>;
  /** Apply-time migration bookkeeping. Absent -> this driver can't run migrations (diff/gen still do). */
  readonly migrations?: MigrationStore<Conn>;
}

// --- Registry -----------------------------------------------------------------------------------

const REGISTRY = new Map<string, Driver<unknown>>();

/** Register a driver under its `name` (idempotent; last write wins). */
export function registerDriver(driver: Driver<unknown>): void {
  REGISTRY.set(driver.name, driver);
}

/** Look up a registered driver, or throw with the list of known names. */
export function getDriver(name: string): Driver<unknown> {
  const d = REGISTRY.get(name);
  if (!d) {
    const known = [...REGISTRY.keys()].join(", ") || "(none registered)";
    throw new Error(`Unknown database driver "${name}". Registered: ${known}.`);
  }
  return d;
}

/** All registered driver names (for help text / config validation). */
export function driverNames(): string[] {
  return [...REGISTRY.keys()];
}
