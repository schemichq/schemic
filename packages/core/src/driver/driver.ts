// The DRIVER interface — the dialect seam for multi-DB support (see docs/MULTI-DB-SPIKE.md).
//
// Everything dialect-specific lives behind a `Driver`: lowering authoring to the Struct-IR, emitting
// DDL, introspecting a live DB, normalizing to a canonical form, and executing. Everything ABOVE the
// driver (the diff algorithm, the magicast TS-merge, the migration model, the CLI shell) stays
// dialect-free and calls these ops.
//
// The connection type is a driver-private parameter `Conn`: the orchestration treats it opaquely and
// only ever hands it back to the SAME driver. So the Surreal driver is `Driver<Surreal>`, a future
// Postgres driver is `Driver<PgClient>`, and core never sees either concrete type. The AUTHORING
// types (`Tbl`/`Def`) are driver-private the same way — opaque to core beyond the neutral
// `Authored`/`AuthoredDef` bounds — so the neutral engine never names a dialect's concrete builder
// (`TableDef`/`StandaloneDef`).

import type { ResolvedConfig } from "../cli/config";
import type { Diff } from "../cli/diff";
import type { Filter } from "../cli/filter";
import type { PullPlan } from "../cli/merge";
import type { Definable, KindRegistry, PortableObject } from "../kind";

/**
 * The dialect-NEUTRAL authoring contract — the only structure the orchestration reads off an
 * authored object (everything else is opaque and handed straight to {@link Driver.explode}). A table
 * contributes just its `name`; this is the upper bound for a driver's table-authoring type. The
 * Surreal `TableDef` is a structural subtype, as is any future dialect's table builder.
 */
export interface Authored {
  readonly name: string;
}

/**
 * The neutral contract for a standalone (non-table) authored object — an event/function/access. It
 * adds a `kind` discriminant and, for objects owned by a table (e.g. an event), the owner `table`
 * name (so the snapshot can file-link a child object under its parent). The Surreal `StandaloneDef`
 * union is a structural subtype.
 */
export interface AuthoredDef extends Authored {
  readonly kind: string;
  readonly table?: string;
}

/**
 * A single emitted DDL statement, structured: object identity (`kind`/`name`/`table`) + the dialect
 * `ddl` string, plus an optional clause map (each value an `ALTER … <set>` form) for dialects that
 * diff clause-level. `kind` is a dialect-defined string the orchestration treats opaquely — the
 * SurrealDB `DefineStatement` (with its fixed kind union) is a structural subtype of this.
 */
export interface Statement {
  kind: string;
  name: string;
  table?: string;
  ddl: string;
  clauses?: Record<string, string>;
}

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
 * migration replay. Absent -> `check`/replay-verification is degraded/unavailable (diff/apply still
 * work, since a kind's `lower`/`introspectAll` already canonicalize).
 */
export interface ShadowCapability<Conn> {
  /** Apply `ddl` to a fresh scratch DB, introspect it back to portable objects, then drop it. */
  roundTrip(
    conn: Conn,
    config: ResolvedConfig,
    ddl: string,
  ): Promise<PortableObject[]>;
  /** Spin up a fully-isolated ephemeral instance (for migration replay). Caller must `stop()`. */
  ephemeral?(): Promise<{ conn: Conn; stop: () => Promise<void> }>;
}

/**
 * A database dialect, expressed as a SET OF KINDS (core-v2). The driver registers its object kinds on
 * `registry`; core orchestrates schema ops GENERICALLY over it (`lowerSchema`/`buildKindDiff`/
 * `emitKinds`/`orderObjects`) — it never names a kind. The driver owns only what isn't generic: the
 * authoring -> kinded `explode`, a single-read `introspectAll`, the connection lifecycle, and the
 * dialect-specific command capabilities. The field/type substrate (`PortableType`/`s.*`) stays core.
 * See docs/kind-registry-flip-plan.md.
 */
export interface Driver<
  Conn = unknown,
  Tbl extends Authored = Authored,
  Def extends AuthoredDef = AuthoredDef,
> {
  readonly name: string;

  // --- kind registry (the schema engine) -----------------------------------------------------
  /** This driver's registered KINDS. Core runs lower/diff/emit/order generically over it. */
  readonly registry: KindRegistry;
  /**
   * Authoring (loaded `defineTable`/standalone defs) -> kinded {@link Definable}s. The driver-side
   * fan-out: one inline-authored table explodes into `[table, ...index, ...event/constraint]`, each
   * tagged with its `kind`. Core then lowers via `lowerSchema(registry, explode(...))` — so
   * `KindEngine.lower` stays 1:1 and the contract needs no explode hook.
   */
  explode(tables: Tbl[], defs: Def[]): Definable[];
  /**
   * Live connection -> ALL portable objects, fanned across kinds from ONE read (INFO STRUCTURE /
   * pg_catalog). Must canonicalize IDENTICALLY to lowering (a clean apply round-trips to a zero diff)
   * and be COMPLETE (return every diffable kind, else presence-phantom-diffs). `exclude` skips tables
   * by name.
   */
  introspectAll(conn: Conn, exclude?: Set<string>): Promise<PortableObject[]>;

  // --- execution -----------------------------------------------------------------------------
  connect(config: ResolvedConfig, over?: ConnectionOverrides): Promise<Conn>;
  apply(conn: Conn, statements: string[], opts?: ApplyOptions): Promise<void>;
  /** Tear down a connection opened by {@link connect} (the orchestration owns the lifecycle). */
  close(conn: Conn): Promise<void>;

  // --- optional capabilities -----------------------------------------------------------------
  readonly shadow?: ShadowCapability<Conn>;
  /** Apply-time migration bookkeeping. Absent -> this driver can't run migrations (diff/gen still do). */
  readonly migrations?: MigrationStore<Conn>;

  // --- optional COMMAND capabilities ---------------------------------------------------------
  // The dialect-agnostic CLI routes each schema-syncing command through one of these. A driver that
  // omits a capability makes that command unavailable on it — the CLI never hardcodes `if surreal`.

  /**
   * Diff the LIVE database against the loaded schema into executable up/down DDL. Owns every
   * dialect-specific normalization and apply-time fixup (Surreal: a shadow-DB round-trip to cancel
   * formatting noise, the redacted-access-key swap, and the implicit-wildcard OVERWRITE re-mark), so
   * the result is safe to apply as-is. Backs `diff --live`, `push`, and the baseline reconcile.
   */
  diffLive?(conn: Conn, config: ResolvedConfig, filter: Filter): Promise<Diff>;
  /** Reduce a live diff (from {@link diffLive}) to the statements `push` applies; `prune: false` keeps removals. */
  syncPlan?(diff: Diff, prune?: boolean): string[];
  /**
   * Render portable objects to per-file source in THIS dialect's `s.*` syntax, filtered — the codegen
   * behind the offline `diff --ts` and `pull`. Takes `PortableObject[]` (this driver's own portable
   * shape): `diff --ts` renders the SNAPSHOT side (stored portable) and the DESIRED side
   * (`lowerSchema(explode(...))`) at MATCHING fidelity so an in-sync schema yields identical files;
   * `pull` renders the introspected DB. The driver re-derives its structured form from the portable
   * objects (parsing its own DDL where needed — docs/kind-registry-flip-plan.md §6b). `single` (a file
   * key) folds everything into one module; otherwise `fileFor` maps each object to its own file.
   */
  renderSchema?(
    objects: PortableObject[],
    filter: Filter,
    fileFor: (kind: string, name: string) => string,
    single?: string,
  ): Map<string, string>;
  /**
   * The two sides of `diff --ts --live` rendered to per-file source: the live DB (`current`) and the
   * declared schema (`desired`), both normalized through the dialect so an unchanged schema yields
   * identical files.
   */
  diffTsLive?(
    conn: Conn,
    config: ResolvedConfig,
    filter: Filter,
    fileFor: (kind: string, name: string) => string,
    single?: string,
  ): Promise<{ current: Map<string, string>; desired: Map<string, string> }>;
  /**
   * Replay every migration into a throwaway engine and diff the result against the schema (`check`).
   * Owns ephemeral-engine selection + setup; `log` receives progress lines. Needs a {@link shadow}-
   * class capability. An empty diff means the migrations reproduce the schema.
   */
  checkReplay?(
    config: ResolvedConfig,
    over: ConnectionOverrides,
    filter: Filter,
    log: (msg: string) => void,
  ): Promise<Diff>;
  /** Introspect the live DB and plan schema-file codegen (`pull`); writing is the neutral `applyPull`. */
  planPull?(
    conn: Conn,
    config: ResolvedConfig,
    opts: { filter: Filter; keepLocal?: boolean },
  ): Promise<PullPlan>;
  /** A human-readable server identity for `doctor` (e.g. "SurrealDB 3.1.3"); throws if unreachable. */
  serverInfo?(conn: Conn): Promise<string>;
  /**
   * Run a raw READ query and return rows — for connection RESOLVERS (a multi-connection resolver's
   * `ctx.connections.<name>.query(...)`) and `seed`. The `sql` is this dialect's query language; the
   * orchestration treats the rows opaquely. Absent -> a resolver can't read from this connection.
   */
  query?<T = unknown>(
    conn: Conn,
    sql: string,
    vars?: Record<string, unknown>,
  ): Promise<T[]>;
  /**
   * The dialect-specific files `schemic init` scaffolds, keyed by project-relative path: a
   * connections-only `schemic.config.ts` (using this driver's `<driver>Connection` factory), a sample
   * schema module in this dialect's `s.*`, a seed stub, a `.env.example`, … The CLI writes them
   * verbatim (never overwriting) alongside the dialect-neutral migration snapshot it records itself.
   * Absent -> `schemic init` can't scaffold a project for this driver.
   */
  initScaffold?(): Record<string, string>;
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
