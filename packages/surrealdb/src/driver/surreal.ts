// The SURREAL driver — driver #1 (see docs/MULTI-DB-SPIKE.md).
//
// A thin adapter over the existing Surreal-specific functions: each op delegates to them and lifts/
// lowers between the SurrealQL string-kind IR (`DbStructured`) and the dialect-independent pivot
// (`PortableDb`) at its boundaries. So no current behavior changes, and the driver speaks the same
// portable IR the diff core and every other driver speak. In the eventual package split this file
// becomes `@surreal-zod/surreal`; for now it lives in core, clearly marked.

import type {
  ApplyOptions,
  ConnectionOverrides as CfgOverrides,
  ConnectionOverrides,
  Diff,
  Driver,
  EmitOptions,
  MigrationRecord,
  MigrationStore,
  PortableDb,
  RenderedUnit,
  ResolvedConfig,
  ShadowCapability,
  Statement,
} from "@schemic/core";
import { keyOf, registerDriver } from "@schemic/core";
import { escapeIdent, type Surreal } from "surrealdb";
import {
  connectEmbedded,
  spawnEphemeralServer,
  surrealBinaryAvailable,
} from "../cli/engine";
import {
  applyStatements,
  diffAgainstDb,
  shadowStructured,
  syncPlan,
  tsStructsAgainstDb,
  verifyMigrations,
} from "../cli/introspect";
import { schemaStruct } from "../cli/lower";
import { planPull, renderPerFile, renderSchemaToTS } from "../cli/pull";
import { deepEqual, normalizeDb } from "../cli/struct";
import type { DbStructured, Snapshot } from "../cli/structure";
import { introspectStructured, structuredSnapshot } from "../cli/structure";
import { connect as surrealConnect } from "../cli/surreal-connect";
import { diffSnapshots, renderMigration } from "../cli/surreal-diff";
import { filterStructured } from "../cli/surreal-filter";
import {
  type DefineStatement,
  overwriteStatement,
  removeStatement,
} from "../ddl";
import type { Shape, StandaloneDef, TableDef } from "../pure";
import { liftDb, lowerDb } from "./surreal-ir";

/**
 * Re-derive the legacy (string-DDL) {@link Snapshot} from the portable IR, so the existing clause-
 * level `diffSnapshots` engine can run unchanged. `statements` come from `emit` (now clause-bearing),
 * `struct` from the lowered IR (drives cosmetic-change detection). Both sides are normalized first.
 */
function toLegacySnapshot(db: PortableDb): Snapshot {
  const norm = liftDb(normalizeDb(lowerDb(db)));
  const statements: Record<string, DefineStatement> = {};
  const snap = structuredSnapshot(lowerDb(norm));
  for (const s of Object.values(snap.statements)) statements[keyOf(s)] = s;
  return { version: 1, statements, struct: lowerDb(norm) };
}

// Apply/emit order: db-level functions first (tables/events may call fn::…), then tables, fields,
// indexes, events, and finally access (SIGNUP/SIGNIN reference tables). Mirrors introspect.ts's RANK.
const RANK: Record<DefineStatement["kind"], number> = {
  function: 0,
  table: 1,
  field: 2,
  index: 3,
  event: 4,
  access: 5,
};

const shadow: ShadowCapability<Surreal> = {
  // Apply DDL to a throwaway database, read it back via INFO STRUCTURE, drop it — the live-side
  // canonicalizer. Delegates to `shadowStructured`, then lifts to the portable IR.
  roundTrip: async (conn, config, ddl) =>
    liftDb(normalizeDb(await shadowStructured(conn, config, ddl))),
  // `ephemeral` (full isolated instance for `sz check` replay) is intentionally not wired here —
  // `check` still uses its existing path. A later milestone routes it through this capability.
};

// --- migration bookkeeping (the apply-time SurrealQL, moved behind the driver) -------------------

/** Record one applied migration: a `_migrations` row keyed by tag, with file + checksum + time. */
const RECORD_SQL =
  "CREATE type::record($tbl, $tag) CONTENT { tag: $tag, file: $file, checksum: $sum, applied_at: time::now() }";
const recordVars = (table: string, r: MigrationRecord) => ({
  tbl: table,
  tag: r.tag,
  file: r.file,
  sum: r.checksum,
});

/** `DEFINE TABLE … SCHEMALESS` for an internal tracking table (migrations or its lock). */
async function ensureTrackTable(conn: Surreal, table: string): Promise<void> {
  await conn.query(
    `DEFINE TABLE IF NOT EXISTS ${escapeIdent(table)} TYPE NORMAL SCHEMALESS PERMISSIONS NONE;`,
  );
}

const lockTableOf = (table: string) => `${table}_lock`;

const migrations: MigrationStore<Surreal> = {
  render: (tag, diff) => renderMigration(tag, diff),
  ensure: ensureTrackTable,

  async applied(conn, table) {
    const [rows] = await conn.query<[{ tag: string; checksum: string }[]]>(
      "SELECT tag, checksum FROM type::table($tbl)",
      { tbl: table },
    );
    return new Map((rows ?? []).map((r) => [r.tag, r.checksum]));
  },

  // SurrealDB is natively transactional — run the migration program + its bookkeeping write in one
  // BEGIN/COMMIT so the record is written iff the DDL applied. `$direction` drives the up/down branch.
  async apply(conn, table, { content, direction, record }) {
    const bookkeep =
      direction === "up"
        ? { sql: RECORD_SQL, vars: recordVars(table, record) }
        : {
            sql: "DELETE type::record($tbl, $tag)",
            vars: { tbl: table, tag: record.tag },
          };
    await conn.query(`BEGIN;\n${content}\n${bookkeep.sql};\nCOMMIT;`, {
      direction,
      ...bookkeep.vars,
    });
  },

  async record(conn, table, record) {
    await ensureTrackTable(conn, table);
    await conn.query(RECORD_SQL, recordVars(table, record));
  },

  async clear(conn, table) {
    await conn.query("DELETE type::table($tbl)", { tbl: table });
  },

  async lock(conn, table) {
    const tbl = lockTableOf(table);
    await ensureTrackTable(conn, tbl);
    try {
      await conn.query(
        "CREATE type::record($tbl, 'lock') CONTENT { at: time::now() }",
        { tbl },
      );
    } catch {
      throw new Error(
        "Migrations are locked — another run is in progress. If it's stale, run `schemic unlock`.",
      );
    }
  },

  async unlock(conn, table) {
    await conn.query("DELETE type::record($tbl, 'lock')", {
      tbl: lockTableOf(table),
    });
  },
};

/**
 * Render a structured schema to per-file source: one combined module under `single`, else one file
 * per object via `fileFor`. Shared by `renderSchema` (offline `diff --ts`) and `diffTsLive`.
 */
function renderFiles(
  struct: DbStructured,
  fileFor: (kind: string, name: string) => string,
  single?: string,
): Map<string, string> {
  return single
    ? new Map([[single, renderSchemaToTS(struct)]])
    : renderPerFile(
        struct,
        fileFor as (kind: RenderedUnit["kind"], name: string) => string,
      );
}

export const surrealDriver: Driver<
  Surreal,
  TableDef<string, Shape>,
  StandaloneDef
> = {
  name: "surrealdb",

  // --- IR pipeline ---------------------------------------------------------------------------

  lower(tables: TableDef<string, Shape>[], defs: StandaloneDef[]): PortableDb {
    // `schemaStruct` returns the NORMALIZED string-kind IR; lift its field kinds to PortableType.
    return liftDb(schemaStruct(tables, defs));
  },

  emit(db: PortableDb, opts?: EmitOptions): Statement[] {
    // Portable IR -> DDL: lower the portable types back to SurrealQL kinds, then rebuild canonical
    // DEFINE statements, ordered for apply. `overwrite` rewrites each as `… OVERWRITE …`.
    const snap = structuredSnapshot(lowerDb(db));
    const stmts = Object.values(snap.statements).sort(
      (a, b) => RANK[a.kind] - RANK[b.kind],
    );
    if (opts?.overwrite) {
      return stmts.map((s) => ({ ...s, ddl: overwriteStatement(s.ddl) }));
    }
    return stmts;
  },

  // SurrealQL replaces in place (DEFINE … OVERWRITE) and removes with REMOVE … IF EXISTS — both
  // non-destructive, so a changed field doesn't drop column data. The surreal driver only ever
  // receives statements it emitted, so they ARE DefineStatements (the neutral Statement's `kind`
  // string narrows back to the surreal kind union here).
  remove: (s) => removeStatement(s as DefineStatement),
  overwrite: (s) => overwriteStatement(s.ddl),

  async introspect(conn: Surreal, exclude?: Set<string>): Promise<PortableDb> {
    return liftDb(await introspectStructured(conn, exclude));
  },

  normalize(db: PortableDb): PortableDb {
    // Reuse the canonicalizer that operates on string kinds: lower -> normalize -> lift.
    return liftDb(normalizeDb(lowerDb(db)));
  },

  // A legacy (v1) snapshot stored the SurrealQL string-kind struct — lift it to the portable IR.
  upgradeSnapshot(legacy: unknown): PortableDb {
    return liftDb(legacy as Parameters<typeof liftDb>[0]);
  },

  equal(a: PortableDb, b: PortableDb): boolean {
    return deepEqual(this.normalize(a), this.normalize(b));
  },

  diff(prev: PortableDb, next: PortableDb): Diff {
    // Bridge to the clause-level Surreal diff engine via re-derived legacy snapshots — preserving
    // ALTER FIELD/ALTER TABLE and the cosmetic-change detection (no portable-IR feature is lost).
    return diffSnapshots(toLegacySnapshot(prev), toLegacySnapshot(next));
  },

  // --- execution -----------------------------------------------------------------------------

  connect(
    config: ResolvedConfig,
    over?: ConnectionOverrides,
  ): Promise<Surreal> {
    // The driver's portable `ConnectionOverrides` is a structural superset of the SDK's; the only
    // soft field is `authLevel` (a string here vs. the SDK's `AuthLevel` union) — pass it through.
    return surrealConnect(config, (over ?? {}) as CfgOverrides);
  },

  async apply(
    conn: Surreal,
    statements: string[],
    opts?: ApplyOptions,
  ): Promise<void> {
    if (!statements.length) return;
    if (opts?.transactional === false) {
      for (const s of statements) await conn.query(s);
      return;
    }
    // SurrealDB is natively transactional — one BEGIN/COMMIT around the batch (matches applyStatements).
    await applyStatements(conn, statements);
  },

  async close(conn: Surreal): Promise<void> {
    await conn.close();
  },

  /**
   * Raw READ query -> rows, for connection resolvers (`ctx.connections.<name>.query(...)`) and seed.
   * SurrealQL returns one result per statement; we hand back the LAST statement's rows (the payload of
   * a `… ; SELECT …` resolver), wrapping a scalar/`RETURN` result and treating none as an empty set.
   */
  async query<T = unknown>(
    conn: Surreal,
    sql: string,
    vars?: Record<string, unknown>,
  ): Promise<T[]> {
    const results = (await conn.query(sql, vars)) as unknown[];
    if (!results.length) return [];
    const last = results[results.length - 1];
    return (Array.isArray(last) ? last : last == null ? [] : [last]) as T[];
  },

  shadow,
  migrations,

  // --- command capabilities (thin adapters over the existing surreal cli functions) ----------

  diffLive: (conn, config, filter) => diffAgainstDb(conn, config, filter),
  syncPlan: (diff, prune) => syncPlan(diff, prune),

  // Offline `diff --ts`: lower the portable IR back to the string-kind struct, filter, render.
  renderSchema(db, filter, fileFor, single) {
    return renderFiles(filterStructured(lowerDb(db), filter), fileFor, single);
  },

  // Live `diff --ts`: both sides normalized through SurrealDB, then rendered per file.
  async diffTsLive(conn, config, filter, fileFor, single) {
    const { current, desired } = await tsStructsAgainstDb(conn, config, filter);
    return {
      current: renderFiles(current, fileFor, single),
      desired: renderFiles(desired, fileFor, single),
    };
  },

  planPull: (conn, config, opts) => planPull(conn, config, opts),

  async serverInfo(conn) {
    let v = "unknown";
    try {
      v = (await conn.version()).version;
    } catch {
      // server version unavailable
    }
    return `SurrealDB ${v}`;
  },

  // `check`: replay every migration into a throwaway engine and diff the result against the schema.
  // Owns ephemeral-engine selection — an embedded @surrealdb/node instance, an ephemeral server from
  // the local `surreal` binary, or a configured scratch server — and the replay never touches the
  // real database. Progress lines go to `log`; the empty/non-empty diff is reported by the caller.
  async checkReplay(config, over, filter, log) {
    const engine = config.checkEngine;
    const useBinary =
      engine === "binary" ||
      (engine === "auto" && surrealBinaryAvailable(config.checkBinary));
    if (engine === "binary" && !useBinary) {
      throw new Error(
        'check.engine "binary" needs the `surreal` CLI on PATH (or set `check.binary`). Run `schemic check --schema` to skip the replay.',
      );
    }

    let db: Surreal;
    let checkCfg: ResolvedConfig;
    let cleanup: () => Promise<void>;
    if (typeof engine === "object") {
      const embedded = await connectEmbedded(engine, "check", "check");
      db = embedded.db;
      checkCfg = {
        ...config,
        db: {
          url: embedded.url,
          namespace: "check",
          database: "check",
          authLevel: "root",
        },
      };
      cleanup = embedded.stop;
      log(
        `  replaying on an ${embedded.url} SurrealDB (@surrealdb/node) — no server, your data untouched`,
      );
    } else if (useBinary) {
      const server = await spawnEphemeralServer(config.checkBinary);
      checkCfg = {
        ...config,
        db: {
          url: server.url,
          namespace: "check",
          database: "check",
          username: server.username,
          password: server.password,
          authLevel: "root",
        },
      };
      db = await surrealConnect(checkCfg, {});
      cleanup = async () => {
        await db.close().catch(() => {});
        await server.stop();
      };
      log(
        "  replaying on an ephemeral in-memory SurrealDB (local `surreal` binary) — your server is untouched",
      );
    } else {
      checkCfg = { ...config, db: config.checkDb };
      try {
        db = await surrealConnect(checkCfg, over as CfgOverrides);
      } catch (e) {
        throw new Error(
          `${e instanceof Error ? e.message : String(e)}\n  (run \`schemic check --schema\` to skip the replay, install the \`surreal\` CLI for an in-memory engine, or set \`check.db\` to point the replay at a scratch server)`,
        );
      }
      cleanup = async () => {
        await db.close().catch(() => {});
      };
      log(
        `  replaying on ${config.checkDb.url} (${config.checkDb.namespace}) — isolated scratch databases; your data is untouched`,
      );
    }

    try {
      return await verifyMigrations(db, checkCfg, filter, (tag) =>
        log(`  ${tag}`),
      );
    } finally {
      await cleanup();
    }
  },
};

registerDriver(surrealDriver as Driver<unknown>);
